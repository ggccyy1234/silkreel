// node scripts/hero.mjs <url> <out> [--width w --height h]: the untouched first viewport, six stills two seconds apart
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +opt('--width', 1440), height: +opt('--height', 900) } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(url)
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(i === 0 ? 1200 : 2000)
  await page.screenshot({ path: `${out}/hero-${String(i)}.png` })
}
await browser.close()
