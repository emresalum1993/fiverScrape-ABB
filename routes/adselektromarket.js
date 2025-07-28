const express = require('express');
const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { google } = require('googleapis');

require('dotenv').config();

const router = express.Router();

const DRIVE_FOLDER_ID = '1QAcbMndwRukzmsmap5o6nm9jMzVCXOmD';
const SHEET_ID = '1lVDDt_mZjuld5Y7QIO9F-4bh9h2fimXGllX5RmOfA8w';
const SHEET_NAME = 'adselektromarket';

// OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set the refresh token
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// Validate required environment variables
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
  console.error('❌ Missing required OAuth2 environment variables:');
  console.error('   - GOOGLE_CLIENT_ID');
  console.error('   - GOOGLE_CLIENT_SECRET');
  console.error('   - GOOGLE_REFRESH_TOKEN');
  console.error('Please set these in your .env file');
}

const auth = oauth2Client;
const drive = google.drive({ version: 'v3', auth });
 

const HEADERS = ['productId', 'stockCode', 'name', 'brand', 'stock', 'price', 'currencyCode'];
const HEADERSSpeaking = ['productId', 'STOCK CODE', 'PART DETAILS', 'BRAND', 'STOCK', 'PRICE', 'CURRENCY'];
const LOCAL_CSV_PATH = path.join(os.tmpdir(), 'adselektromarket-products.csv');
console.log(LOCAL_CSV_PATH)
let driveFileId = null;
let isFirstWrite = !fs.existsSync(LOCAL_CSV_PATH);
const existingProductIds = new Set();

function csvRow(product) {
  return HEADERS.map(key =>
    `"${(product[key] || '').toString().replace(/"/g, '""').replace(/\r?\n|\r/g, ' ')}"`
  ).join(',') + '\n';
}

async function appendToLocalCSV(product) {
  const row = isFirstWrite ? HEADERSSpeaking.join(',') + '\n' + csvRow(product) : csvRow(product);
  fs.appendFileSync(LOCAL_CSV_PATH, row);
  isFirstWrite = false;
}

async function flushToDrive() {
  if (!fs.existsSync(LOCAL_CSV_PATH)) return;

  if (!driveFileId) {
    const fileMetadata = {
      name: 'adselektromarket-products.csv',
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

async function loadExistingDriveProductIds() {
  const query = `'${DRIVE_FOLDER_ID}' in parents and name='adselektromarket-products.csv' and trashed=false`;
  const res = await drive.files.list({
    q: query,
    fields: 'files(id, modifiedTime)',
    spaces: 'drive'
  });

  const file = res.data.files[0];
  if (file) {
    const modifiedTime = new Date(file.modifiedTime);
    const age = Date.now() - modifiedTime.getTime();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    if (age > oneWeek) {
      await drive.files.delete({ fileId: file.id });
      console.log('🗑️ Old Drive file deleted (older than 7 days)');
    } else {
      driveFileId = file.id;
      const content = await downloadDriveFile(file.id);
      content.split('\n').slice(1).forEach(line => {
        const id = line.split(',')[0]?.replace(/"/g, '');
        if (id) existingProductIds.add(id);
      });
      console.log(`📄 Loaded ${existingProductIds.size} existing product IDs from Drive`);
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

// Main Route
router.get('/', async (req, res) => {
  await loadExistingDriveProductIds();

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: 5,
    puppeteerOptions: {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

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

    const productsData = await page.evaluate(() => {
      return typeof PRODUCT_DATA !== 'undefined' ? PRODUCT_DATA : [];
    });

    const rows = productsData
      .filter(p => p.id && !existingProductIds.has(p.id.toString()))
      .map(p => {
        const vatRate = parseFloat(p.vat) || 0;
        const rawVatPrice = p.total_sale_price ;
        const priceWithVat = parseFloat(rawVatPrice);
        const priceWithoutVat = priceWithVat / (1 + vatRate / 100);

        return {
          productId: p.id || '',
          stockCode: p.supplier_code || '',
          name: p.name || '',
          brand: p.brand || '',
          currencyCode: 'TRY',
          stock: p.quantity || 0,
          price: isNaN(priceWithoutVat) ? '' : parseFloat(priceWithoutVat.toFixed(2))
        };
      });

    for (const product of rows) {
      await appendToLocalCSV(product);
      existingProductIds.add(product.productId);
    }

    console.log(`✅ Scraped ${rows.length} new products from: ${url}`);
  });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  await page.goto('https://www.adselektromarket.com/srv/service/category/get/');
  const categories = await page.evaluate(() => JSON.parse(document.body.innerText));

  for (const category of categories) {
    const slug = category.LINK;
    const title = category.TITLE;
    const categoryUrl = `https://www.adselektromarket.com/${slug}?pg=1`;

    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded' });

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

  await flushToDrive();

 // const rows = parseCSV(LOCAL_CSV_PATH);
  
  res.json({ status: 'done', total: rows.length, driveFileId });
});

module.exports = router;
