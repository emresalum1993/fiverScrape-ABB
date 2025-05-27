const express = require('express');
const router = express.Router();

// Delay helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

router.get('/', async (req, res) => {
  let browser, page; // Declare in outer scope to access in catch block

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

    // Go to home page and simulate interaction
    await page.goto("https://elektrofors.com", { waitUntil: "domcontentloaded" });
    await page.clickAndWaitForNavigation("body");
    await delay(5000);

    // Go to product page
    await page.goto("https://www.elektrofors.com/schneider-electric-lc1d12m7-tesys-deca-12-amper-5-5-kw-3-kutuplu-kontaktor-220-volt-ac-1na-1nk", { waitUntil: "domcontentloaded" });

    // Wait for the price element
    await page.waitForSelector('.product-price', { visible: true });

    // Get full HTML
    const pageHtml = await page.content();

    await browser.close();

    res.setHeader('Content-Type', 'text/html');
    res.send(pageHtml);

  } catch (error) {
    console.error('❌ Puppeteer Error:', error);

    let errorHtml = `<h1>Error running Puppeteer</h1><pre>${error.message}</pre>`;
    
    // Try to get current page HTML if browser is still open
    if (page) {
      try {
        const partialHtml = await page.content();
        errorHtml += `<hr><h2>Captured Page HTML:</h2>${partialHtml}`;
      } catch (innerError) {
        errorHtml += `<hr><p>Could not capture page HTML: ${innerError.message}</p>`;
      }
    }

    if (browser) {
      await browser.close();
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(500).send(errorHtml);
  }
});

module.exports = router;
