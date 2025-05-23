const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { parseStringPromise } = require('xml2js');
const pLimit = require('p-limit');
const cliProgress = require('cli-progress');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

require('dotenv').config();

const router = express.Router();

const CONCURRENCY = 80;
const PRICE_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const FLUSH_INTERVAL_ROWS = 500;

// ✅ Use productId as first column
const HEADERS = ['productId', 'stockCode', 'name', 'brand', 'stock', 'price', 'currency'];
const HEADERSSpeaking = ['PRODUCT ID', 'STOCK CODE', 'PART DETAILS', 'BRAND', 'STOCK', 'PRICE', 'CURRENCY'];
const LOCAL_CSV_PATH = path.join(os.tmpdir(), 'elektrofors-products.csv');
const DRIVE_FOLDER_ID = '1QAcbMndwRukzmsmap5o6nm9jMzVCXOmD';

const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
  ],
  ...(process.env.NODE_ENV === 'local' && {
    keyFile: path.join(__dirname, '../credentials/weekly-stock-price-dashboard-614dc05eaa42.json')
  })
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

const SHEET_ID = '1lVDDt_mZjuld5Y7QIO9F-4bh9h2fimXGllX5RmOfA8w';
const SHEET_NAME = 'elektrofors';

let driveFileId = null;
let isFirstWrite = !fs.existsSync(LOCAL_CSV_PATH);
let rowCountSinceLastFlush = 0;
const scrapedProductIds = new Set();

function csvRow(product) {
  return HEADERS.map(key =>
    `"${(product[key] || '').toString().replace(/"/g, '""')}"`
  ).join(',') + '\n';
}

async function appendToLocalCSV(product) {
  const row = isFirstWrite ? HEADERSSpeaking.join(',') + '\n' + csvRow(product) : csvRow(product);
  fs.appendFileSync(LOCAL_CSV_PATH, row);
  isFirstWrite = false;
  rowCountSinceLastFlush++;

  if (rowCountSinceLastFlush >= FLUSH_INTERVAL_ROWS) {
    rowCountSinceLastFlush = 0;
    await flushLocalFileToDrive();
  }
}

async function flushLocalFileToDrive() {
  if (!fs.existsSync(LOCAL_CSV_PATH)) return;

  if (!driveFileId) {
    const fileMetadata = {
      name: 'elektrofors-products.csv',
      parents: [DRIVE_FOLDER_ID],
      mimeType: 'text/csv'
    };
    const media = {
      mimeType: 'text/csv',
      body: fs.createReadStream(LOCAL_CSV_PATH)
    };
    const res = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id'
    });
    driveFileId = res.data.id;
    console.log(`📁 Created new Drive file with ID: ${driveFileId}`);
    return;
  }

  const media = {
    mimeType: 'text/csv',
    body: fs.createReadStream(LOCAL_CSV_PATH)
  };

  await drive.files.update({
    fileId: driveFileId,
    media
  });

  console.log('☁️ Synced local file to Google Drive');
}

async function downloadDriveFile(fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  let data = '';
  for await (const chunk of res.data) {
    data += chunk;
  }
  return data;
}

async function prepareDriveFileAndLoadExistingIds() {
  const query = `'${DRIVE_FOLDER_ID}' in parents and name='elektrofors-products.csv' and trashed=false`;
  const res = await drive.files.list({
    q: query,
    fields: 'files(id, modifiedTime)',
    spaces: 'drive'
  });

  const file = res.data.files[0];
  if (file) {
    const modifiedTime = new Date(file.modifiedTime);
    const age = Date.now() - new Date(file.modifiedTime).getTime();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    if (age > oneWeek) {
      await drive.files.delete({ fileId: file.id });
      console.log('🗑️ Old Drive file deleted (older than 7 days)');
    } else {
      driveFileId = file.id;
      const content = await downloadDriveFile(file.id);
      content.split('\n').slice(1).forEach(line => {
        const id = line.split(',')[0]?.replace(/"/g, '');
        if (id) scrapedProductIds.add(id);
      });
      console.log(`📄 Loaded ${scrapedProductIds.size} existing product IDs from Drive`);
    }
  }
}

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const rows = content.trim().split('\n').map(line =>
    line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell =>
      cell.replace(/^"|"$/g, '').replace(/""/g, '"')
    )
  );
  return rows;
}

function logFailure(productId, error) {
  console.warn(`❌ Failed ${productId || 'unknown'}: ${error.message}`);
}

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

router.get('/', async (req, res) => {
  const routeUrl = req.protocol + '://' + req.get('host') + req.originalUrl;

  try {
    await prepareDriveFileAndLoadExistingIds();

    const total = await getTotalEstimatedProducts();
    const remainingIds = Array.from({ length: total }, (_, i) => i + 1)
      .filter(id => !scrapedProductIds.has(id.toString()));

    console.log(`🧮 Total estimated: ${total}, Skipping ${scrapedProductIds.size}, Scraping ${remainingIds.length}`);

    const limit = pLimit(CONCURRENCY);
    const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progress.start(remainingIds.length, 0);

    let successCount = 0;

    const tasks = remainingIds.map(productId =>
      limit(async () => {
        let stockCode = '';
        try {
          const htmlUrl = `https://www.elektrofors.com/index.php?route=journal3/product&product_id=${productId}`;

          const html = await retryWithDelay(() =>
            axios.get(htmlUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US' }
            })
          );

          const $ = cheerio.load(html.data);
          const title = $('h1.title').text().trim();
          if (!title) throw new Error('Invalid product page');

          const brand = $('.product-manufacturer a').text().trim();
          stockCode = $('.product-model span').text().trim();

          const priceData = await priceLimit(() =>
            retryWithDelay(() =>
              axios.post(
                'https://www.elektrofors.com/index.php?route=journal3/price',
                new URLSearchParams({ product_id: productId }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
              )
            )
          );

          const rawTax = priceData?.data?.response?.tax || '';
          const cleanedTax = rawTax
            .replace('KDV Hariç:', '')
            .replace('TL', '')
            .trim();

          const price = parseFloat(cleanedTax.replace(/[^\d,]/g, '').replace(',', '.'));
          const stock = priceData?.data?.response?.stock || '';

          const product = {
            productId: productId.toString(),
            stockCode,
            name: title,
            brand,
            stock,
            price: isNaN(price) ? '' : price,
            currency : 'TL'
          };

          await appendToLocalCSV(product);
          successCount++;
        } catch (err) {
          logFailure(productId, err);
          const fallback = {
            productId: productId.toString(),
            stockCode,
            name: '',
            brand: '',
            stock: '',
            price: ''
          };
          await appendToLocalCSV(fallback);
        } finally {
          progress.increment();
        }
      })
    );

    await Promise.all(tasks);
    progress.stop();

    await flushLocalFileToDrive(); // final sync

 
    res.json({ status: 'done', total, scraped: successCount, driveFileId });
  } catch (err) {
    console.error('❌ Scraping failed:', err);

    if (process.env.ALLOW_SELF_RECALL === 'true') {
      console.log('↩️ Retrying by calling self...');
      try {
        await axios.get(routeUrl);
      } catch (retryErr) {
        console.error('🛑 Self-recall failed:', retryErr.message);
      }
    }

    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
