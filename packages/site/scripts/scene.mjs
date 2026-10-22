// Records the scene in real time: the re-print into the film, an ink pick, a board swap, and the re-print back into the board. node scripts/scene.mjs <url> <outdir>
import { chromium } from 'playwright'
const url = process.argv[2], out = process.argv[3]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.goto(url)
await page.waitForTimeout(2500)
const span = await page.evaluate(() => { const el = document.querySelector('#ascent'); return { top: el.offsetTop, span: el.offsetHeight - innerHeight } })
const y = (f) => span.top + span.span * f
await page.evaluate((v) => scrollTo(0, v), y(0.33))
await page.waitForTimeout(1500)
for (let i = 0; i <= 60; i++) { await page.mouse.wheel(0, (y(0.5) - y(0.33)) / 60); await page.waitForTimeout(60) }
await page.waitForTimeout(2500)
await page.click('[data-ink-pick="copper"]')
await page.waitForTimeout(3500)
await page.click('[data-board="glasgow"]')
await page.waitForTimeout(2500)
await page.evaluate((v) => scrollTo(0, v), y(0.66)); await page.waitForTimeout(1200)
for (let i = 0; i <= 60; i++) { await page.mouse.wheel(0, (y(0.82) - y(0.66)) / 60); await page.waitForTimeout(60) }
await page.waitForTimeout(2500)
await ctx.close(); await browser.close()
