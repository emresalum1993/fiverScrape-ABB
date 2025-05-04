const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { parseStringPromise } = require('xml2js');
const pLimit = require('p-limit');
const cliProgress = require('cli-progress');

const router = express.Router();


const OUTPUT_PATH = path.join(__dirname, '..', 'outputs', 'elektrofors-products.csv');
const FAILED_LOG_PATH = path.join(__dirname, '..', 'outputs', 'failed-products.log');
const CONCURRENCY = 80;
const PRICE_CONCURRENCY = 10;
const MAX_RETRIES = 3;

const HEADERS = ['productId', 'name', 'brand', 'price', 'stock', 'quantity', 'url', 'image', 'status'];

if (!fs.existsSync(path.dirname(OUTPUT_PATH))) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
}

const outputStream = fs.createWriteStream(OUTPUT_PATH, { flags: 'a' });
const failedLog = fs.createWriteStream(FAILED_LOG_PATH, { flags: 'a' });
let isFirstWrite = !fs.existsSync(OUTPUT_PATH) || fs.statSync(OUTPUT_PATH).size === 0;

// -------- CSV Safe Writing --------
const writeQueue = [];
let isWriting = false;
function flushWriteQueue() {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  const { data, resolve } = writeQueue.shift();
  outputStream.write(data, () => {
    isWriting = false;
    resolve();
    flushWriteQueue();
  });
}
function appendToCSV(product) {
  return new Promise(resolve => {
    const row = HEADERS.map(key => `"${(product[key] || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
    const data = isFirstWrite ? HEADERS.join(',') + '\n' + row : row;
    if (isFirstWrite) isFirstWrite = false;
    writeQueue.push({ data, resolve });
    flushWriteQueue();
  });
}
function logFailure(productId, error) {
  failedLog.write(`${productId}: ${error.message}\n`);
}

// -------- Utilities --------
async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function retryWithDelay(fn, retries = MAX_RETRIES, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const shouldRetry = !status || (status >= 500 && status < 600) || status === 429;
      if (!shouldRetry || i === retries - 1) throw err;

      console.warn(`🔁 Retry ${i + 1}/${retries} due to error: ${status || err.message}`);
      await wait(delayMs * (i + 1));
    }
  }
}

// -------- Your Original Sitemap Logic --------
async function getTotalEstimatedProducts() {
  const { data } = await axios.get('https://www.elektrofors.com/sitemap.xml');
  const sitemap = await parseStringPromise(data);
  const sitemapUrls = sitemap.sitemapindex?.sitemap.map(entry => entry.loc[0]) || [];

  const productSitemaps = sitemapUrls.filter(url => url.includes('sitemap-product-'));
  const lastNum = Math.max(
    ...productSitemaps.map(url => {
      const match = url.match(/sitemap-product-(\d+)\.xml/);
      return match ? parseInt(match[1]) : 0;
    })
  );
  return lastNum * 500;
}

// -------- Resume Support --------
function getScrapedProductIds() {
  if (!fs.existsSync(OUTPUT_PATH)) return new Set();
  const content = fs.readFileSync(OUTPUT_PATH, 'utf8');
  const lines = content.split('\n').slice(1);
  return new Set(lines.map(line => line.split(',')[0]).filter(Boolean));
}

// -------- Price Request Throttler --------
const priceLimit = pLimit(PRICE_CONCURRENCY);

// -------- Main Scraper --------
router.get('/', async (req, res) => {
  try {
    const total = await getTotalEstimatedProducts();
    const scrapedIds = getScrapedProductIds();

    const remainingIds = Array.from({ length: total }, (_, i) => i + 1).filter(
      id => !scrapedIds.has(id.toString())
    );

    console.log(`🧮 Total estimated: ${total}, Remaining: ${remainingIds.length}`);

    const limit = pLimit(CONCURRENCY);
    const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progress.start(remainingIds.length, 0);

    let successCount = 0;

    const tasks = remainingIds.map(productId =>
      limit(async () => {
        try {
          const htmlUrl = `https://www.elektrofors.com/index.php?route=journal3/product&product_id=${productId}&popup=quickview`;

          const html = await retryWithDelay(() =>
            axios.get(htmlUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept-Language': 'en-US'
              }
            })
          );

          const $ = cheerio.load(html.data);
          const title = $('h1.title').text().trim();
          if (!title) throw new Error('Invalid product page');

          const brand = $('.product-manufacturer a').text().trim();
          const image = $('.product-image img').first().attr('src') || '';
          const url = $('a.btn-more-details').attr('href') || '';

          const priceData = await priceLimit(() =>
            retryWithDelay(() =>
              axios.post(
                'https://www.elektrofors.com/index.php?route=journal3/price',
                new URLSearchParams({ product_id: productId }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
              )
            )
          );

          const rawPrice = priceData?.data?.response?.price || '';
          const price = parseFloat(rawPrice.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.'));
          const stock = priceData?.data?.response?.stock || '';
          const quantity = priceData?.data?.response?.quantity || '';

          const product = {
            productId,
            name: title,
            brand,
            price: isNaN(price) ? '' : price,
            stock,
            quantity,
            url,
            image,
            status: 'ok'
          };

          await appendToCSV(product);
          successCount++;
        } catch (err) {
          logFailure(productId, err);
          const fallback = {
            productId,
            name: '',
            brand: '',
            price: '',
            stock: '',
            quantity: '',
            url: '',
            image: '',
            status: 'failed'
          };
          await appendToCSV(fallback);
        } finally {
          progress.increment();
        }
      })
    );

    await Promise.all(tasks);
    progress.stop();
    outputStream.end();
    failedLog.end();

    res.json({ status: 'done', total, scraped: successCount, output: OUTPUT_PATH });
  } catch (err) {
    console.error('❌ Scraping failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
