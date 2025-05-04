const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.get('/', async (req, res) => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Block unnecessary resources
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    const allowed = ['document', 'xhr', 'fetch', 'script'];
    if (allowed.includes(type)) {
      req.continue();
    } else {
      req.abort();
    }
  });

  const products = [];
  let currentPage = 1;

  const csvHeaders = [
    'name',
    'url',
    'image',
    'stockCode',
    'description',
    'productId',
    'stock',
    'quantity',
    'price'
  ];

  const outputPath = path.join(__dirname, '..', 'outputs', 'agonepay.csv');
  fs.writeFileSync(outputPath, csvHeaders.join(',') + '\n', 'utf-8');

  // Helper to get stock/price info
  const getStockData = async (page, productId) => {
    return await page.evaluate(async (productId) => {
      try {
        const response = await fetch('index.php?route=journal3/price', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          body: new URLSearchParams({ product_id: productId })
        });
        const json = await response.json();
        return {
          stock: json?.response?.stock || null,
          quantity: json?.response?.quantity || null,
          price: json?.response?.price || null
        };
      } catch (e) {
        return { stock: null, quantity: null, price: null };
      }
    }, productId);
  };

  try {
    while (true) {
      const url = `https://agonepay.com/index.php?route=product/search&search=&description=true&limit=500&page=${currentPage}`;
      console.log(`Scraping page ${currentPage}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const hasProducts = await page.$('.main-products .product-layout');
      if (!hasProducts) break;

      const pageProducts = await page.evaluate(() => {
        const items = document.querySelectorAll('.product-thumb');
        return Array.from(items).map(el => {
          return {
            name: el.querySelector('.name a')?.innerText.trim() || '',
            url: el.querySelector('.name a')?.href || '',
            image: el.querySelector('img')?.src || '',
            stockCode: el.querySelector('.stat-2 span:nth-child(2)')?.innerText.trim() || '',
            description: el.querySelector('.description')?.innerText.trim() || '',
            productId: el.querySelector('input[name="product_id"]')?.value || null
          };
        });
      });

      // Batched stock/price fetch (30 at a time)
      const concurrencyLimit = 30;
      let i = 0;

      while (i < pageProducts.length) {
        const batch = pageProducts.slice(i, i + concurrencyLimit);
        await Promise.all(
          batch.map(p =>
            getStockData(page, p.productId).then(stockData => {
              p.stock = stockData.stock;
              p.quantity = stockData.quantity;

              const rawPrice = stockData.price || '';
              const numericPrice = parseFloat(
                rawPrice.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.')
              );
              p.price = isNaN(numericPrice) ? null : numericPrice;
            })
          )
        );
        i += concurrencyLimit;
      }

      // Append to CSV
      const csvRows = pageProducts.map(p =>
        csvHeaders.map(h => `"${(p[h] || '').toString().replace(/"/g, '""')}"`).join(',')
      );
      fs.appendFileSync(outputPath, csvRows.join('\n') + '\n', 'utf-8');

      products.push(...pageProducts);
      console.log(`→ Done with page ${currentPage}, saved ${pageProducts.length} products.`);
      currentPage++;
    }

    await browser.close();
    res.json({ total: products.length, savedTo: outputPath });

  } catch (err) {
    await browser.close();
    console.error(err);
    res.status(500).send('Scraping failed.');
  }
});

module.exports = router;
