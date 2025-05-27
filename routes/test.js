const express = require('express');
const router = express.Router();

const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');

puppeteer.use(StealthPlugin());
// Solve captchas using 2Captcha
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: 'b218082f5ddea70bdbf8b14af2efec14', // ⬅️ Your API key
    },
    visualFeedback: false,
  })
);

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

router.get('/', async (req, res) => {
  let browser, page;

  try {
    // Dynamically import the ESM modules
    const { connect } = await import("puppeteer-real-browser");
    const clickAndWaitPlugin = (await import("puppeteer-extra-plugin-click-and-wait")).default;

    // Launch browser
    const connected = await connect({
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
      turnstile: true,
      headless: false,
      connectOption: {
        defaultViewport: null,
      },
      plugins: [clickAndWaitPlugin()],
    });

    page = connected.page;
    browser = connected.browser;

    const results = [];
    const productIds = Array.from({ length: 100 }, (_, i) => i + 1); // Generate array of IDs 1-100

    // Go to home page first
    await page.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });
    await delay(2000);

    // Process products sequentially
    for (const productId of productIds) {
      try {
        // Go to product page
        const productUrl = `https://www.elektrofors.com/index.php?route=journal3/product&product_id=${productId}`;
        await page.goto(productUrl, { waitUntil: "domcontentloaded" });
        await delay(2000);

        // Check if product exists
        const productExists = await page.evaluate(() => {
          return !document.querySelector('.alert-danger');
        });

        if (!productExists) {
          results.push({
            productId,
            status: 'not_found'
          });
          continue;
        }

        // Wait for the price element
        await page.waitForSelector('.product-price', { visible: true, timeout: 5000 }).catch(() => null);

        // Get product data
        const productData = await page.evaluate(() => {
          const price = document.querySelector('.product-price')?.textContent.trim() || 'N/A';
          const title = document.querySelector('h1')?.textContent.trim() || 'N/A';
          const sku = document.querySelector('.product-sku')?.textContent.trim() || 'N/A';
          
          return {
            price,
            title,
            sku
          };
        });

        results.push({
          productId,
          status: 'success',
          ...productData
        });

      } catch (error) {
        results.push({
          productId,
          status: 'error',
          error: error.message
        });
      }

      // Add delay between products to avoid rate limiting
      await delay(2000);
    }

    await browser.close();

    res.json({
      status: 'success',
      totalProducts: results.length,
      results
    });

  } catch (error) {
    console.error('❌ Puppeteer Error:', error);
    
    if (browser) {
      await browser.close();
    }

    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});


router.get('/2', async (req, res) => {
  let browser2, page2;

  try {
    // STEP 1: Bypass Cloudflare via real browser
    const { connect } = await import('puppeteer-real-browser');
    const clickAndWaitPlugin = (await import('puppeteer-extra-plugin-click-and-wait')).default;

    console.log('connecting to real browser');
    const connected = await connect({
      args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
      turnstile: true,
      headless: false,
      connectOption: {
        defaultViewport: null,
      },
      plugins: [clickAndWaitPlugin()],
    });

    page2 = connected.page;
    browser2 = connected.browser;
    console.log('connected to real browser');
    // Visit homepage to pass Cloudflare
    await page2.goto('https://elektrofors.com', { waitUntil: 'domcontentloaded' });
    await delay(5000); // give it time to pass Turnstile
    console.log('cookies');
    const cookies = await page2.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const userAgent = await page2.evaluate(() => navigator.userAgent);
    await delay(2000);
    await browser2.close(); // real browser done
    console.log('real browser closed');
    // STEP 2: Use cookies in puppeteer-cluster
    await delay(2000);
    const productIds = Array.from({ length: 20 }, (_, i) => i + 1);
    const results = [];

    console.log('cluster')
    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: 5,
      puppeteer,
      timeout: 60000,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-features=IsolateOrigins,site-per-process'
        ],
      },
      monitor: false,
    });

    await cluster.task(async ({ page, data: productId }) => {
      try {
        await page.setUserAgent(userAgent);
        await page.setExtraHTTPHeaders({
          'Cookie': cookieHeader
        });

        const productUrl = `https://www.elektrofors.com/index.php?route=journal3/product&product_id=${productId}`;
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const productExists = await page.evaluate(() => {
          return !document.querySelector('.alert-danger');
        });

        if (!productExists) {
          results.push({ productId, status: 'not_found' });
          return;
        }

        await page.waitForSelector('.product-price', { visible: true, timeout: 5000 }).catch(() => null);

        const productData = await page.evaluate(() => {
          const price = document.querySelector('.product-price')?.textContent.trim() || 'N/A';
          const title = document.querySelector('h1')?.textContent.trim() || 'N/A';
          const sku = document.querySelector('.product-sku')?.textContent.trim() || 'N/A';
          return { price, title, sku };
        });

        results.push({ productId, status: 'success', ...productData });

      } catch (err) {
        results.push({ productId, status: 'error', error: err.message });
      }
    });

    for (const id of productIds) {
      cluster.queue(id);
    }

    await cluster.idle();
    await cluster.close();

    res.json({
      status: 'success',
      totalProducts: results.length,
      results
    });

  } catch (error) {
    console.error('❌ Scraping Error:', error);
    if (browser) await browser.close();
    res.status(500).json({ status: 'error', message: error.message });
  }
});
router.get('/stealth', async (req, res) => {
  try {
    const productIds = Array.from({ length: 20 }, (_, i) => i + 1); // Example range
    const results = [];

    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: 3,
      puppeteer,
      timeout: 60000,
      puppeteerOptions: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--disable-software-rasterizer',
          '--disable-features=IsolateOrigins,site-per-process',
        ]
      },
      monitor: false,
    });

    await cluster.task(async ({ page, data: productId }) => {
      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );

        const productUrl = `https://www.elektrofors.com/index.php?route=journal3/product&product_id=${productId}`;
        await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 🧠 Solve CAPTCHAs if present
        const { solved, error } = await page.solveRecaptchas();
        if (error) {
          console.warn(`❌ CAPTCHA solve error for ID ${productId}:`, error.message);
        }

        const productExists = await page.evaluate(() => {
          return !document.querySelector('.alert-danger');
        });

        if (!productExists) {
          results.push({ productId, status: 'not_found' });
          return;
        }

        await page.waitForSelector('.product-price', { visible: true, timeout: 5000 }).catch(() => null);

        const productData = await page.evaluate(() => {
          const price = document.querySelector('.product-price')?.textContent.trim() || 'N/A';
          const title = document.querySelector('h1')?.textContent.trim() || 'N/A';
          const sku = document.querySelector('.product-sku')?.textContent.trim() || 'N/A';
          return { price, title, sku };
        });

        results.push({ productId, status: 'success', ...productData });

        await delay(1000); // optional throttle

      } catch (err) {
        results.push({ productId, status: 'error', error: err.message });
      }
    });

    for (const id of productIds) {
      cluster.queue(id);
    }

    await cluster.idle();
    await cluster.close();

    res.json({
      status: 'success',
      totalProducts: results.length,
      results
    });

  } catch (error) {
    console.error('❌ Scraping Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

module.exports = router;
