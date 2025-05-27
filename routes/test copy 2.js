const express = require('express');
const router = express.Router();

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

module.exports = router;
