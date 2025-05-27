const express = require('express');
const router = express.Router();
const { connect } = require("puppeteer-real-browser");
router.get('/', async (req, res) => {
  try {
    const { page, browser } = await connect({
        args: ["--start-maximized"],
        turnstile: true,
        headless: false,
        // disableXvfb: true,
        customConfig: {},
        connectOption: {
          defaultViewport: null,
        },
        plugins: [require("puppeteer-extra-plugin-click-and-wait")()],
      });
      await page.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });
      await page.clickAndWaitForNavigation("body");
      await delay(10000);
    await page.screenshot({ path: 'example.png' }); // Use /tmp in Cloud Run or local
    await delay(1000);
    await browser.close();

    res.send('Screenshot taken successfully.');
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Error running Puppeteer');
  }
});
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
module.exports = router;
