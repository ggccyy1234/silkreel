// Films the countdown and its handoff: node scripts/count.mjs <url> <outdir> [--width w --height h]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +opt('--width', 1440), height: +opt('--height', 900) } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()) })
const t0 = Date.now()
await page.goto(url, { waitUntil: 'commit' })
for (const at of [250, 700, 1200, 1700, 2000, 2300, 2600, 3000, 3600]) {
  await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)))
  await page.screenshot({ path: `${out}/c-${String(at).padStart(4, '0')}.png` })
}
await browser.close()
