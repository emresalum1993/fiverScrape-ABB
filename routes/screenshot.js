const express = require('express');
const router = express.Router();
const { Cluster } = require('puppeteer-cluster');
const fs = require('fs');
const path = require('path');

const urls = [
  "https://www.elektrofors.com/",
  "https://eticaret.botekendustri.com/",
  "https://anelelektromarket.com/",
  "https://ozdisan.com/",
  "https://online.tumpaelektrik.com/",
  "https://e2onlinemarket.com/",
  "https://endelkon.com.tr/",
  "https://www.otomasyonmarketi.com/",
  "https://www.teknikaonline.com/",
  "https://www.endustrimall.com/",
  "https://www.garmak.com.tr/",
  "https://b2b.kiracelektrik.com/",
  "https://www.hmimarket.com/"
];

const outputDir = path.join(__dirname, '..', 'screenshots');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

router.get('/', async (req, res) => {
  const visitCounts = {};

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 5,
    puppeteerOptions: { headless: true }
  });

  await cluster.task(async ({ page, data: url }) => {
    if (!visitCounts[url]) visitCounts[url] = 0;
    visitCounts[url] += 1;
    const visitNum = visitCounts[url];

    console.log(`🔁 [${visitNum}/100] Visiting: ${url}`);

    // Hook to log main document response
    let mainResponse = null;
    page.on('response', response => {
      if (response.url() === url && !mainResponse) {
        mainResponse = response;
      }
    });

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const status = response?.status() || mainResponse?.status();
      console.log(`🔎 Status for ${url}: ${status || 'Unknown'}`);

      if (visitNum === 100) {
        const hostname = new URL(url).hostname.replace(/[^a-z0-9]/gi, '_');
        const screenshotPath = path.join(outputDir, `${hostname}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`✅ Final screenshot saved: ${screenshotPath}`);
      }
    } catch (err) {
      console.error(`❌ Error on ${url}:`, err.message);
    }
  });

  // Queue each URL 100 times
  urls.forEach(url => {
    for (let i = 0; i < 100; i++) {
      cluster.queue(url);
    }
  });

  await cluster.idle();
  await cluster.close();

  res.json({ message: '✅ Completed 100 visits per URL. Final screenshots saved.' });
});

module.exports = router;
