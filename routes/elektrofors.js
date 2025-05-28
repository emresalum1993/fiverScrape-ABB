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
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

require('dotenv').config();

const router = express.Router();

const CONCURRENCY = 2;
const PRICE_CONCURRENCY = 3;
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

let cloudflareCookies = null;
let cloudflareHeaders = null;

// Add these at the top level
let browser = null;
let isInitialized = false;

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

async function initializeBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      targetFilter: (target) => target.type() !== "other",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080'
      ]
    });
    console.log('🌐 Browser initialized');
  }
  return browser;
}

async function getPageWithPuppeteer(url, options = {}) {
  try {
    // Initialize browser if not already done
    if (!browser) {
      browser = await initializeBrowser();
    }

    // Use the default page first to bypass Cloudflare if not already done
    if (!isInitialized) {
      const defaultPage = (await browser.pages())[0];
      await defaultPage.setViewport({
        width: 1920,
        height: 1080
      });

      // First visit the main site to establish Cloudflare bypass
      console.log('🌐 Initial visit to establish Cloudflare bypass...');
      await defaultPage.goto('https://www.elektrofors.com', {
        waitUntil: 'networkidle0',
        timeout: 60000
      });

      // Wait a bit to ensure Cloudflare is properly bypassed
      await new Promise(resolve => setTimeout(resolve, 2000));
      isInitialized = true;
    }

    // Create a new page for the actual URL
    console.log('🌐 Navigating to:', url);
    const targetPage = await browser.newPage();
    await targetPage.setViewport({
      width: 1920,
      height: 1080
    });

    // If it's a POST request
    if (options.method === 'POST') {
      await targetPage.setRequestInterception(true);
      targetPage.on('request', request => {
        if (request.url() === url) {
          request.continue({
            method: 'POST',
            postData: options.data,
            headers: {
              ...request.headers(),
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          });
        } else {
          request.continue();
        }
      });
    }

    // Navigate to the URL
    await targetPage.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // If we need to wait for a specific selector
    if (options.waitForSelector) {
      console.log('⏳ Waiting for selector:', options.waitForSelector);
      await targetPage.waitForSelector(options.waitForSelector, {
        visible: true,
        timeout: 30000
      });
    }

    // Get the response data
    let responseData;
    if (options.isJson) {
      responseData = await targetPage.evaluate(() => {
        const pre = document.querySelector('pre');
        return pre ? JSON.parse(pre.textContent) : null;
      });
    } else {
      responseData = await targetPage.content();
    }

    // Close the page after getting the data
    await targetPage.close();
    return responseData;
  } catch (error) {
    console.error('❌ Puppeteer error:', error);
    throw error;
  }
}

async function getTotalEstimatedProducts() {
  console.log('🔍 Getting total estimated products...');
  const html = await getPageWithPuppeteer('https://www.elektrofors.com/sitemap.xml');
  
  // Parse the HTML table
  const $ = cheerio.load(html);
  const productSitemaps = [];
  
  // Find all product sitemap links in the table
  $('#sitemap tbody tr').each((_, row) => {
    const url = $(row).find('td:first-child a').attr('href');
    if (url && url.includes('sitemap-product-')) {
      productSitemaps.push(url);
    }
  });

  console.log(`📋 Found ${productSitemaps.length} product sitemaps`);
  
  // Get the highest sitemap number
  const lastNum = Math.max(
    ...productSitemaps.map(url => {
      const match = url.match(/sitemap-product-(\d+).xml/);
      return match ? parseInt(match[1]) : 0;
    })
  );

  console.log(`🔢 Highest sitemap number: ${lastNum}`);
  return lastNum * 500;
}

const priceLimit = pLimit(PRICE_CONCURRENCY);

// Add cleanup function
async function cleanup() {
  if (browser) {
    console.log('🧹 Cleaning up browser...');
    await browser.close();
    browser = null;
    isInitialized = false;
  }
}

// Modify the router to handle cleanup
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
        let page = null;
        try {
          const htmlUrl = `https://www.elektrofors.com/index.php?route=journal3/product&product_id=${productId}`;
          console.log(`\n🔄 Processing product ${productId}...`);

          // Get product page content
          page = await retryWithDelay(async () => {
            console.log(`📄 Creating new page for ${productId}...`);
            const targetPage = await browser.newPage();
            
            await targetPage.setViewport({
              width: 1920,
              height: 1080
            });

            // Set a longer timeout for navigation
            console.log(`🌐 [${productId}] Navigating to ${htmlUrl}...`);
            const response = await targetPage.goto(htmlUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 90000
            });
            console.log(`✅ [${productId}] Navigation complete. Status: ${response.status()}`);

            // Wait for the site-wrapper with a shorter timeout
            console.log(`⏳ [${productId}] Waiting for .site-wrapper...`);
            await targetPage.waitForSelector('.site-wrapper', {
              visible: true,
              timeout: 30000
            });
            console.log(`✅ [${productId}] .site-wrapper found`);

            return targetPage;
          });

          console.log(`🔍 [${productId}] Extracting data...`);
          // Extract data using page.evaluate()
          const productData = await page.evaluate(() => {
            const title = document.querySelector('h1.title')?.textContent?.trim();
            if (!title) return null;

            const brand = document.querySelector('.product-manufacturer a')?.textContent?.trim();
            const stockCode = document.querySelector('.product-model span')?.textContent?.trim();
            
            // Get price from product-tax
            const rawTax = document.querySelector('.product-tax')?.textContent?.trim() || '';
            const cleanedTax = rawTax
              .replace('KDV Hariç:', '')
              .replace('TL', '')
              .trim();

            // Get stock from product-stock
            const stock = document.querySelector('li.product-stock span')?.textContent?.trim();

            return {
              title,
              brand,
              stockCode,
              rawTax: cleanedTax,
              stock
            };
          });

          if (!productData) throw new Error('Invalid product page');

          const price = parseFloat(productData.rawTax.replace(/[^\d,]/g, '').replace(',', '.'));
          
          const product = {
            productId: productId.toString(),
            stockCode: productData.stockCode,
            name: productData.title,
            brand: productData.brand,
            stock: productData.stock,
            price: isNaN(price) ? '' : price,
            currency: 'TL'
          };

          console.log(`✅ [${productId}] Successfully extracted data`);
          await appendToLocalCSV(product);
          successCount++;
        } catch (err) {
          console.error(`❌ [${productId}] Error:`, err.message);
          if (page) {
            try {
              const screenshotPath = `error-${productId}.png`;
              await page.screenshot({ path: screenshotPath });
              console.log(`📸 [${productId}] Saved error screenshot to ${screenshotPath}`);
            } catch (screenshotErr) {
              console.error(`❌ [${productId}] Failed to take error screenshot:`, screenshotErr.message);
            }
          }
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
          if (page) {
            await page.close();
            console.log(`🧹 [${productId}] Page closed`);
          }
          progress.increment();
        }
      })
    );

    await Promise.all(tasks);
    progress.stop();

    await flushLocalFileToDrive(); // final sync
    await cleanup(); // Clean up browser after scraping is done

    res.json({ status: 'done', total, scraped: successCount, driveFileId });
  } catch (err) {
    console.error('❌ Scraping failed:', err);
    await cleanup(); // Clean up browser on error

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
