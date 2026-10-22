// Captures the developed print from the live page as the no-WebGL poster: node scripts/poster.mjs <url> <out.png>
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(url)
await page.waitForTimeout(4000)
const data = await page.evaluate(() => document.querySelector('[data-print]').toDataURL('image/png'))
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'))
await browser.close()
