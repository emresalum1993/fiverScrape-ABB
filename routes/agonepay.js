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
const SHEET_NAME = 'agonepay';

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

// ✅ productId added as first column
const csvHeaders = ['productId', 'stockCode', 'name', 'brand', 'stock', 'price','currency'];

const csvHeadersSpeaking = ['PRODUCT ID', 'STOCK CODE', 'PART DETAILS', 'BRAND', 'STOCK', 'PRICE','CURRENCY'];


const LOCAL_CSV_PATH = path.join(os.tmpdir(), 'agonepay-products.csv');
let driveFileId = null;
let isFirstWrite = !fs.existsSync(LOCAL_CSV_PATH);
const existingProductIds = new Set();

function csvRow(product) {
  return csvHeaders.map(key => {
    const value = (product[key] || '').toString().replace(/"/g, '""');
    return `"${value}"`;
  }).join(',') + '\n';
}

async function appendToLocalCSV(product) {
  const row = isFirstWrite ? csvHeadersSpeaking.join(',') + '\n' + csvRow(product) : csvRow(product);
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
          stock: json?.response?.quantity || null,
          price: json?.response?.price || null
        };
      } catch (e) {
        return { stock: null, price: null };
      }
    }, productId);
  };
 

  try {
    while (true) {
      const url = `https://agonepay.com/index.php?route=product/search&search=&description=true&limit=70&page=${currentPage}`;
      console.log(`Scraping page ${currentPage}: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
      const hasProducts = await page.$('.main-products .product-layout');
      if (!hasProducts) break;
  
      // Step 1: Get productId, name, stockCode
      const rawProducts = await page.evaluate(() => {
        const items = document.querySelectorAll('.product-thumb');
        return Array.from(items).map(el => {
          return {
            name: el.querySelector('.description')?.innerText.trim() || '',
            stockCode: el.querySelector('.stat-2 span:nth-child(2)')?.innerText.trim() || '',
         //   partDetails: el.querySelector('.description')?.innerText.trim() || '',
            productId: el.querySelector('input[name="product_id"]')?.value || null
          };
        });
      });
  
      const productIds = rawProducts.map(p => p.productId).filter(Boolean);
  
      // Step 2: Pull full metadata from dataLayer
      const metadataMap = await getProductMetadataFromDataLayer(page, productIds);
  
      // Step 3: Merge metadata into products
      const pageProducts = rawProducts.map(p => {
        const meta = metadataMap[p.productId] || {};


        const rawPrice = meta.price || '';
        const numericPrice = parseFloat(
          rawPrice.replace(/[^\d.,]/g, '').replace('.', '').replace(',', '.')
        );
        return {
          productId: p.productId,
          stockCode: p.stockCode,
          name: p.name,
          brand: meta.brand || '--',
          category: meta.category || '',
          price: isNaN(numericPrice) ? '' : numericPrice,
          stock: null, // will be updated below,
        currency: meta.currency || ''
        };
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
            })
          )
        );
        i += concurrencyLimit;
      }
  
      for (const product of newProducts) {
        const obj ={
          productId: product.productId,
          stockCode: product.stockCode,
          name: product.name,
          brand: product.brand,
          stock: product.stock,
          price: product.price,
          currency: product.currency
        }
        await appendToLocalCSV(obj);

        console.log(obj)
        
        existingProductIds.add(product.productId);
      }
  
      products.push(...newProducts);
      console.log(`→ Done with page ${currentPage}, saved ${newProducts.length} new products.`);
      currentPage++;
    }
  
    await browser.close();
    await flushToDrive();
  
    const rows = parseCSV(LOCAL_CSV_PATH);
    const sheetRows = rows.map(row => row.slice(1)); // removes the first column (productId)

    console.log(`📊 Updating Google Sheet "${SHEET_NAME}" with ${rows.length} rows...`);
  
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
  

    console.log(rows)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: sheetRows }
    });
  
    console.log(`✅ Google Sheet "${SHEET_NAME}" updated successfully.`);
    res.json({ total: products.length, driveFileId });
  
  } catch (err) {
    await browser.close();
    console.error('❌ Scraping failed:', err);
    res.status(500).send('Scraping failed.');
  }

  

  
  
});

async function getBrandsFromE4Logs(page, productIds) {
  const brands = {};
  const expectedCount = productIds.length;
  let seenCount = 0;

  const handleLog = msg => {
    const text = msg.text();
    if (text.includes('item_brand:')) {
      const idMatch = text.match(/item_id:\s*(\d+)/);
      const brandMatch = text.match(/item_brand:\s*([^/]+?)\s*(?:\/|$)/);

      if (idMatch && brandMatch) {
        const id = idMatch[1];
        const brand = brandMatch[1].trim();
        brands[id] = brand;
        seenCount++;
      }
    }
  };

  page.on('console', handleLog);

  // Trigger all brand logging
  await page.evaluate((ids) => {
    ids.forEach(id => {
      try {
        window.e4_item?.select?.(id, 'search');
      } catch (e) {}
    });
  }, productIds);

  // Wait until most logs are likely flushed or timeout
  const timeout = 2000; // max 2s
  const interval = 100;
  let waited = 0;

  while (waited < timeout && seenCount < expectedCount) {
    await new Promise(resolve => setTimeout(resolve, interval));
    waited += interval;
  }

  page.off('console', handleLog);
  return brands;
}

async function getProductMetadataFromDataLayer(page, productIds) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  await page.evaluate((ids) => {
    ids.forEach((id, index) => {
      try {
        window.e4_item.select(id, 'search');
      } catch (e) {
        console.log(e)
      }
    });
  }, productIds);

  // Small delay to let dataLayer populate
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Pull metadata from dataLayer
  const metadataMap = await page.evaluate(() => {
    const result = {};
    const layer = Array.isArray(window.dataLayer) ? window.dataLayer : [];

    layer.forEach(entry => {
      if (entry.event === 'select_item' && entry.ecommerce?.items) {
        entry.ecommerce.items.forEach(item => {
          if (item.item_id) {
            result[item.item_id] = {
              brand: item.item_brand || '--',
            //  name: item.item_name || '',
              category: item.item_category || '',
              price: item.price || '',
                  currency: item.currency || ''
            };
          }
        });
      }
    });

    return result;
  });

  return metadataMap;
}




module.exports = router;

