const express = require('express');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const router = express.Router();

router.get('/', async (req, res) => {
  const OUTPUT_PATH = path.join(__dirname, '..', 'outputs', 'adselektromarket.csv');
  const HEADERS = ['name', 'url', 'image', 'stockCode', 'description', 'productId', 'stock', 'quantity', 'price'];

  // Create /outputs and CSV file with headers
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, HEADERS.join(',') + '\n', 'utf-8');

  let cluster;

  try {
    cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: 5,
      puppeteerOptions: {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    // Task to scrape and append after each page
    await cluster.task(async ({ page, data }) => {
      const { url, category } = data;
      console.log(`🔎 Scraping: ${category} → ${url}`);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        const allowed = ['document', 'xhr', 'fetch', 'script'];
        allowed.includes(type) ? req.continue() : req.abort();
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const products = await page.evaluate(() => {
        return typeof PRODUCT_DATA !== 'undefined' ? PRODUCT_DATA : [];
      });

      const rows = products.map(p => ({
        name: p.name || '',
        url: 'https://www.adselektromarket.com/' + (p.url || ''),
        image: p.image || '',
        stockCode: p.code || '',
        description: p.category_path || '',
        productId: p.id || '',
        stock: (p.quantity || 0) > 0 ? 'In Stock' : 'Out of Stock',
        quantity: p.quantity || 0,
        price: p.total_sale_price || 0
      }));

      // Append to CSV immediately
      const csvLines = rows.map(p =>
        HEADERS.map(h => `"${(p[h] || '').toString().replace(/"/g, '""')}"`).join(',')
      );
      fs.appendFileSync(OUTPUT_PATH, csvLines.join('\n') + '\n', 'utf-8');

      console.log(`✅ Page scraped: ${url} → ${rows.length} products`);
    });

    // Use single browser to get categories and max page numbers
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    await page.goto('https://www.adselektromarket.com/srv/service/category/get/');
    const categories = await page.evaluate(() => JSON.parse(document.body.innerText));

    for (const category of categories) {
      const slug = category.LINK;
      const title = category.TITLE;
      const categoryUrl = `https://www.adselektromarket.com/${slug}?pg=1`;

      await page.goto(categoryUrl, { waitUntil: 'domcontentloaded' });

      // Find the last page number from pagination
      const maxPage = await page.evaluate(() => {
        const pag = document.querySelector('.pagination');
        if (!pag) return 1;
        const pageNums = Array.from(pag.querySelectorAll('a'))
          .map(a => parseInt(a.textContent.trim()))
          .filter(n => !isNaN(n));
        return pageNums.length ? Math.max(...pageNums) : 1;
      });

      console.log(`📂 Category: ${title} (${maxPage} pages)`);

      for (let pg = 1; pg <= maxPage; pg++) {
        const pageUrl = `https://www.adselektromarket.com/${slug}?pg=${pg}`;
        cluster.queue({ url: pageUrl, category: title });
      }
    }

    await browser.close();
    await cluster.idle();
    await cluster.close();

    res.json({ status: 'done', output: OUTPUT_PATH });

  } catch (err) {
    console.error('❌ Scraping error:', err);
    if (cluster) await cluster.close();
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
