const express = require('express');
const router = express.Router();

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

router.get('/', async (req, res) => {
  try {
    // Dynamically import the ESM modules
    const { connect } = await import("puppeteer-real-browser");
    const clickAndWaitPlugin = (await import("puppeteer-extra-plugin-click-and-wait")).default;

    // Launch browser
    const { page, browser } = await connect({
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
      turnstile: true,
      headless: false,
      connectOption: {
        defaultViewport: null,
      },
      plugins: [clickAndWaitPlugin()],
    });

    // Go to home page and simulate interaction
    await page.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });
    await page.clickAndWaitForNavigation("body");
    await delay(5000); // Optional wait for interactions

    // Go to product page
    await page.goto("https://www.elektrofors.com/schneider-electric-lc1d12m7-tesys-deca-12-amper-5-5-kw-3-kutuplu-kontaktor-220-volt-ac-1na-1nk", { waitUntil: "domcontentloaded" });

    // Wait for the price element
    await page.waitForSelector('.product-price', { visible: true });

    // Get full HTML of current page
    const pageHtml = await page.content();

    await browser.close();

    // Send raw HTML
    res.setHeader('Content-Type', 'text/html');
    res.send(pageHtml);
    
  } catch (error) {
    console.error('❌ Puppeteer Error:', error);
    res.status(500).send('Error running Puppeteer');
  }
});

module.exports = router;
