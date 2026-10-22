// usage: node scripts/seq.mjs <url> <outprefix> <ms,ms,...> [--width w --height h]
import { chromium } from 'playwright'
const [url, prefix, times] = process.argv.slice(2)
const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +opt('--width', 1440), height: +opt('--height', 900) } })
if (args.includes('--reduced')) await page.emulateMedia({ reducedMotion: 'reduce' })
const t0 = Date.now()
await page.goto(url, { waitUntil: 'commit' })
for (const t of times.split(',').map(Number)) {
  const wait = t - (Date.now() - t0)
  if (wait > 0) await page.waitForTimeout(wait)
  await page.screenshot({ path: `${prefix}-${String(t).padStart(5, '0')}.png` })
}
await browser.close()
