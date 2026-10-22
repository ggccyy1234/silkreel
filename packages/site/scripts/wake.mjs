// Wake stills: node scripts/wake.mjs <url> <outdir> — sweeps the pointer across the board, then shoots the drain
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(url)
await page.waitForTimeout(2500)
await page.evaluate(() => { const el = document.querySelector('#ascent'); window.scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * 0.15) })
await page.waitForTimeout(2500)
await page.mouse.move(260, 420)
for (let i = 0; i <= 40; i++) { await page.mouse.move(260 + i * 22, 420 - Math.sin(i / 6) * 160); await page.waitForTimeout(16) }
await page.screenshot({ path: `${out}/0-sweep.png` })
await page.waitForTimeout(350); await page.screenshot({ path: `${out}/1-drain-350.png` })
await page.waitForTimeout(500); await page.screenshot({ path: `${out}/2-drain-850.png` })
await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/3-settled.png` })
await browser.close()
