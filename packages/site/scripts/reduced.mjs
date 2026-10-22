// Screenshot a page with prefers-reduced-motion: node scripts/reduced.mjs <url> <out.png> [--width w --height h]
import { chromium } from 'playwright'
const [url, out] = process.argv.slice(2)
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +opt('--width', 1440), height: +opt('--height', 900) }, reducedMotion: 'reduce' })
await page.goto(url)
await page.waitForTimeout(5000)
await page.screenshot({ path: out })
await browser.close()
