const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

require('dotenv').config();

const router = express.Router();

// Google Drive / Sheets config
const DRIVE_FOLDER_ID = '1QAcbMndwRukzmsmap5o6nm9jMzVCXOmD';
const SHEET_ID = '1lVDDt_mZjuld5Y7QIO9F-4bh9h2fimXGllX5RmOfA8w';
const SHEET_NAME = 'agorepay';

const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
  ],
  ...(process.env.NODE_ENV === 'local' && {
    keyFile: path.join(__dirname, '../credentials/deli-df508-036d92c21c6b.json')
  })
});
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });
const csvHeaders = [
  'name',
  'url',
  'stockCode',
  'productId',
  'stock',
  'quantity',
  'price'
];



const LOCAL_CSV_PATH = path.join(os.tmpdir(), 'agonepay-products.csv');
let driveFileId = null;
let isFirstWrite = !fs.existsSync(LOCAL_CSV_PATH);
const existingProductIds = new Set();

// Helpers
function csvRow(product) {
  return csvHeaders.map(key =>
    `"${(product[key] || '')
      .toString()
      .replace(/"/g, '""')
      .replace(/\r?\n|\r/g, ' ') // strip line breaks
    }"`
  ).join(',') + '\n';
}


async function appendToLocalCSV(product) {
  const row = isFirstWrite ? csvHeaders.join(',') + '\n' + csvRow(product) : csvRow(product);
  fs.appendFileSync(LOCAL_CSV_PATH, row);
  isFirstWrite = false;
}

async function flushToDrive() {
  if (!fs.existsSync(LOCAL_CSV_PATH)) return;

  if (!driveFileId) {
    const fileMetadata = {
      name: 'agonepay-products.csv',
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
  const query = `'${DRIVE_FOLDER_ID}' in parents and name='agonepay-products.csv' and trashed=false`;
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
        const id = line.split(',')[5]?.replace(/"/g, '');
        if (id) existingProductIds.add(id);
      });
      console.log(`📄 Loaded ${existingProductIds.size} existing product IDs from Drive`);
    }
  }
}

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const rows = content.trim().split('\n').map(line => {
    return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell =>
      cell.replace(/^"|"$/g, '').replace(/""/g, '"')
    );
  });
  return rows;
}

// Main Route
router.get('/', async (req, res) => {
  await loadExistingDriveProductIds();

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

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
            stockCode: el.querySelector('.stat-2 span:nth-child(2)')?.innerText.trim() || '',
            productId: el.querySelector('input[name="product_id"]')?.value || null
          };
        });
        
        
      });

      const newProducts = pageProducts.filter(p => p.productId && !existingProductIds.has(p.productId));
      console.log(`⏩ Skipping ${pageProducts.length - newProducts.length} already scraped products.`);

      const concurrencyLimit = 30;
      let i = 0;

      while (i < newProducts.length) {
        const batch = newProducts.slice(i, i + concurrencyLimit);
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

      for (const product of newProducts) {
        await appendToLocalCSV(product);
        existingProductIds.add(product.productId);
      }

      products.push(...newProducts);
      console.log(`→ Done with page ${currentPage}, saved ${newProducts.length} new products.`);

      currentPage++;
    }

    await browser.close();
    await flushToDrive();

    const rows = parseCSV(LOCAL_CSV_PATH);
    console.log(`📊 Updating Google Sheet "${SHEET_NAME}" with ${rows.length} rows...`);

    // Try clearing sheet content (only supported on native Google Sheets)
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1:Z1000`
      });
      console.log('🧹 Cleared existing sheet data.');
    } catch (err) {
      if (err.code === 400) {
        console.warn(`⚠️ Sheet may be non-native XLSX. Skipping clear step: ${err.message}`);
      } else {
        throw err;
      }
    }

    // Write new values
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });

    console.log(`✅ Google Sheet "${SHEET_NAME}" updated successfully.`);
    res.json({ total: products.length, driveFileId });

  } catch (err) {
    await browser.close();
    console.error('❌ Scraping failed:', err);
    res.status(500).send('Scraping failed.');
  }
});

module.exports = router;
