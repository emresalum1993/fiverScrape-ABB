const express = require('express');
const router = express.Router();

const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');

puppeteer.use(StealthPlugin());
// Solve captchas using 2Captcha
/* puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: 'b218082f5ddea70bdbf8b14af2efec14', // ⬅️ Your API key
    },
    visualFeedback: false,
  })
); */

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}




router.get('/', async (req, res) => {
  let browser2, seedPage;

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

    seedPage = connected.page;
    browser2 = connected.browser;
 
    // Go to home page first
    await seedPage.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });
    await delay(20000);
 
    const cookies = await seedPage.cookies(); // ✅ No URL needed
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    console.log('cookies', cookies);

    await browser2.close();
    await delay(2000);
    res.json({
      status: 'success',
    
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
    await delay(20000); // give it time to pass Turnstile
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
router.get('/s', async (req, res) => {
  let browser2, seedPage;

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

    seedPage = connected.page;
    browser2 = connected.browser;
 
    // Go to home page first
    await seedPage.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });
    await delay(20000);
 
    const cookies = await seedPage.cookies(); // ✅ No URL needed
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    console.log('cookies', cookies);

    await browser2.close();
    await delay(2000);
 

  } catch (error) {
    console.error('❌ Puppeteer Error:', error);
    
    if (browser2) {
      await browser2.close();
    }

    
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
        ],
      },
      monitor: false,
    });


    await cluster.task(async ({ page, data: productId }) => {
      try {
        await page.setUserAgent(userAgent);
        await page.setExtraHTTPHeaders({
          Cookie: cookieHeader,
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
        await delay(500);

      } catch (err) {
        results.push({ productId, status: 'error', error: err.message });
      }
    });

    for (const id of productIds) {
      cluster.queue(id);
    }

    await cluster.idle();
    await cluster.close();
    await baseBrowser.close();

    res.json({
      status: 'success',
      totalProducts: results.length,
      results,
    });

  }
 
});



router.get('/s2', async (req, res) => {
  let browser2, seedPage;

  try {
    // Step 1: Launch puppeteer-real-browser to pass Cloudflare
    const { connect } = await import("puppeteer-real-browser");
    const clickAndWaitPlugin = (await import("puppeteer-extra-plugin-click-and-wait")).default;

    const connected = await connect({
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
      turnstile: true,
      headless: false,
      connectOption: { defaultViewport: null },
      plugins: [clickAndWaitPlugin()],
    });

    seedPage = connected.page;
    browser2 = connected.browser;

    await seedPage.goto("https://elektrofors.com", { waitUntil: "networkidle2" });

    // Wait for Cloudflare/Turnstile to pass
    await delay(10000);

    const cookies = await seedPage.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const userAgent = await seedPage.evaluate(() => navigator.userAgent);

    await browser2.close(); // Close seed browser

    // Step 2: Launch Puppeteer Cluster and scrape in parallel using extracted cookies
    const results = [];
    const productIds = Array.from({ length: 20 }, (_, i) => i + 1);

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
        ],
      },
      monitor: false,
    });

    await cluster.task(async ({ page, data: productId }) => {
      try {
        await page.setUserAgent(userAgent);
        await page.setExtraHTTPHeaders({
          Cookie: cookieHeader,
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
        await delay(500); // Optional delay between tasks
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
      results,
    });

  } catch (error) {
    console.error('❌ Puppeteer Error:', error);
    if (browser2) await browser2.close();
    res.status(500).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
