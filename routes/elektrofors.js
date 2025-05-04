const express = require('express');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { parseStringPromise } = require('xml2js');
const pLimit = require('p-limit');
const cliProgress = require('cli-progress');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const stream = require('stream');

const router = express.Router();
require('dotenv').config();

const CONCURRENCY = 80;
const PRICE_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const HEADERS = ['productId', 'name', 'brand', 'price', 'stock', 'quantity', 'url', 'image', 'status'];

const drive = google.drive({ version: 'v3' });
const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/drive.file'],
  ...(process.env.NODE_ENV === 'local' && {
    keyFile: path.join(__dirname, '../credentials/deli-df508-036d92c21c6b.json')
  })
});
google.options({ auth });

let driveFileId = null;
let bufferData = '';
let isFirstWrite = true;
async function createDriveFile() {
  const folderId = '1QAcbMndwRukzmsmap5o6nm9jMzVCXOmD'; // 👈 your folder ID

  const fileMetadata = {
    name: 'elektrofors-products.csv',
    mimeType: 'text/csv',
    parents: [folderId] // 👈 this places it in the folder
  };

  const media = {
    mimeType: 'text/csv',
    body: stream.Readable.from('')
  };

  const res = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: 'id'
  });

  driveFileId = res.data.id;
  console.log(`📁 Created Google Drive file in folder ${folderId}, ID: ${driveFileId}`);
}

async function appendToDriveCSV(dataChunk) {
  bufferData += dataChunk;

  if (bufferData.length > 10000) { // Flush every ~10KB
    await flushToDrive();
  }
}

async function flushToDrive() {
  if (!driveFileId || !bufferData) return;

  const res = await drive.files.get({
    fileId: driveFileId,
    alt: 'media'
  }, { responseType: 'stream' });

  let existingData = '';
  for await (const chunk of res.data) {
    existingData += chunk;
  }

  const combined = existingData + bufferData;
  bufferData = '';

  const media = {
    mimeType: 'text/csv',
    body: stream.Readable.from(combined)
  };

  await drive.files.update({
    fileId: driveFileId,
    media
  });
}

function csvRow(product) {
  return HEADERS.map(key => `"${(product[key] || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
}

async function appendToCSV(product) {
  const row = isFirstWrite ? HEADERS.join(',') + '\n' + csvRow(product) : csvRow(product);
  isFirstWrite = false;
  await appendToDriveCSV(row);
}

function logFailure(productId, error) {
  console.warn(`❌ Failed ${productId}: ${error.message}`);
}

// -------- Utilities --------
function wait(ms) {
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

async function getTotalEstimatedProducts() {
  const { data } = await axios.get('https://www.elektrofors.com/sitemap.xml');
  const sitemap = await parseStringPromise(data);
  const sitemapUrls = sitemap.sitemapindex?.sitemap.map(entry => entry.loc[0]) || [];

  const productSitemaps = sitemapUrls.filter(url => url.includes('sitemap-product-'));
  const lastNum = Math.max(
    ...productSitemaps.map(url => {
      const match = url.match(/sitemap-product-(\d+).xml/);
      return match ? parseInt(match[1]) : 0;
    })
  );
  return lastNum * 500;
}

const priceLimit = pLimit(PRICE_CONCURRENCY);

// -------- Main Route --------
router.get('/', async (req, res) => {
  try {
    await createDriveFile();

    const total = await getTotalEstimatedProducts();
    const remainingIds = Array.from({ length: total }, (_, i) => i + 1);

    console.log(`🧮 Total estimated: ${total}`);

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
              headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US' }
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
    await flushToDrive();

    res.json({ status: 'done', total, scraped: successCount, driveFileId });
  } catch (err) {
    console.error('❌ Scraping failed:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
