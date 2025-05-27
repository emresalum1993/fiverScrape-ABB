const express = require('express');
const router = express.Router();

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

router.get('/', async (req, res) => {
  try {
    // Dynamically import the ESM module inside async route
    const { connect } = await import("puppeteer-real-browser");

    const clickAndWaitPlugin = (await import("puppeteer-extra-plugin-click-and-wait")).default;

    const { page, browser } = await connect({
      args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"],
      turnstile: true,
      headless: false, // Important for xvfb
      connectOption: {
        defaultViewport: null,
      },
      plugins: [clickAndWaitPlugin()],
    });

    await page.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });

    // Wait or simulate interaction
    await page.clickAndWaitForNavigation("body");
    await delay(10000);

    // ✅ Save screenshot to /tmp for Cloud Run compatibility
    await page.screenshot({ path: '/tmp/example.png' });

    await browser.close();

    res.send('✅ Screenshot taken and browser closed.');
  } catch (error) {
    console.error('❌ Puppeteer Error:', error);
    res.status(500).send('Error running Puppeteer');
  }
});

module.exports = router;
