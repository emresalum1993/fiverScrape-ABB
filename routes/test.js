const express = require('express');
const router = express.Router();

const { Cluster } = require('puppeteer-cluster');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha')
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: 'b218082f5ddea70bdbf8b14af2efec14' // REPLACE THIS WITH YOUR OWN 2CAPTCHA API KEY ⚡
    },
    visualFeedback: true // colorize reCAPTCHAs (violet = detected, green = solved)
  })
)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    await delay(100);
 
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
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage']
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

   
        await page.solveRecaptchas()

        await delay(5000)
        await page.mouse.move(100, 100);
await page.mouse.click(100, 100);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await delay(2000);

        const screenshotPath = `product-${productId}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const productExists = await page.evaluate(() => {
          return !document.querySelector('.alert-danger');
        });

        if (!productExists) {
          results.push({ productId, status: 'not_found' });
          return;
        }
       
        // 🧠 Your original scraping logic preserved
        const productData = await page.evaluate(() => {
          const title = document.querySelector('h1.title')?.textContent?.trim();
          if (!title) return null;

          const brand = document.querySelector('.product-manufacturer a')?.textContent?.trim();
          const stockCode = document.querySelector('.product-model span')?.textContent?.trim();

          const rawTax = document.querySelector('.product-tax')?.textContent?.trim() || '';
          const cleanedTax = rawTax
            .replace('KDV Hariç:', '')
            .replace('TL', '')
            .trim();

          const stock = document.querySelector('li.product-stock span')?.textContent?.trim();

          return {
            title,
            brand,
            stockCode,
            rawTax: cleanedTax,
            stock
          };
        });

        if (!productData) {
          results.push({ productId, status: 'error', error: 'Invalid product page' });
          return;
        }

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

        results.push({ status: 'success', ...product });
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
