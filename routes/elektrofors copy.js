const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const router = express.Router();

router.get('/', async (req, res) => {
  const OUTPUT_PATH = path.join(__dirname, '..', 'outputs', 'elektrofors.csv');
  const HEADERS = ['name', 'url', 'image', 'stockCode', 'description', 'productId', 'stock', 'quantity', 'price'];
  const CATEGORIES = [
    'https://www.elektrofors.com/dagitim-ve-kontrol-urunleri',
    'https://www.elektrofors.com/endustriyel-otomasyon-urunleri',
    'https://www.elektrofors.com/enerji-kalitesi-ve-izleme',
    'https://www.elektrofors.com/ev-ve-ofis-elektrigi',
    'https://www.elektrofors.com/baglanti-teknigi-urunleri'
  ];

  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, HEADERS.join(',') + '\n', 'utf-8');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let totalCount = 0;

  try {
    for (const baseUrl of CATEGORIES) {
      console.log(`🔍 Scraping category: ${baseUrl}`);
      let pageNum = 1;
      while (true) {
        const pagedUrl = `${baseUrl}/limit-200?page=${pageNum}`;
        console.log(`→ Page ${pageNum}: ${pagedUrl}`);

        await page.goto(pagedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const products = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('.main-products .product-layout'));
          return items.map(el => {
            const nameEl = el.querySelector('.name a');
            const imgEl = el.querySelector('.image img');
            const stockCodeEl = el.querySelector('.stat-2 span');
            const descEl = el.querySelector('.description');
            const productIdEl = el.querySelector('input[name="product_id"]');

            return {
              name: nameEl?.innerText.trim() || '',
              url: nameEl?.href || '',
              image: imgEl?.src || '',
              stockCode: stockCodeEl?.innerText.trim() || '',
              description: descEl?.innerText.trim() || '',
              productId: productIdEl?.value || ''
            };
          });
        });

        if (!products.length) break; // End of pages

        const ajaxResults = await Promise.all(products.map(p =>
          page.evaluate(async (productId) => {
            try {
              const res = await fetch('index.php?route=journal3/price', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ product_id: productId })
              });
              const json = await res.json();
              return { productId, ...json?.response };
            } catch {
              return { productId, stock: '', quantity: '', price: '' };
            }
          }, p.productId)
        ));

        const enriched = products.map(prod => {
          const data = ajaxResults.find(d => d.productId === prod.productId) || {};
          const rawPrice = data.price || '';
          const numericPrice = parseFloat(
            rawPrice.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.')
          );

          return {
            ...prod,
            stock: data.stock || '',
            quantity: data.quantity || '',
            price: isNaN(numericPrice) ? '' : numericPrice
          };
        });

        for (const record of enriched) {
          const row = HEADERS.map(h => `"${(record[h] || '').toString().replace(/"/g, '""')}"`).join(',');
          fs.appendFileSync(OUTPUT_PATH, row + '\n', 'utf-8');
          console.log(`✅ Saved: ${record.name}`);
        }

        totalCount += enriched.length;
        pageNum++;
      }
    }

    await browser.close();
    res.json({ status: 'done', total: totalCount, output: OUTPUT_PATH });

  } catch (err) {
    await browser.close();
    console.error('❌ Scraping failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
