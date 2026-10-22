// The package drawing: the live print at plan view, cropped to the board. node scripts/plan.mjs <url> <raw.png>, then scripts/plan-crop.py
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
// open the print's field wide so the whole board prints, floor and falloff included (capture only)
await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype
  const names = new WeakMap()
  const get = P.getUniformLocation
  P.getUniformLocation = function (prog, name) { const l = get.call(this, prog, name); if (l) names.set(l, name); return l }
  const u2 = P.uniform2f
  P.uniform2f = function (l, a, b) { return names.get(l) === 'uFloor' ? u2.call(this, l, 5, 6) : u2.call(this, l, a, b) }
  const u4 = P.uniform4f
  P.uniform4f = function (l, a, b, c, d) { return names.get(l) === 'uField' ? u4.call(this, l, a, b, 5, 6) : u4.call(this, l, a, b, c, d) }
})
await page.goto(url)
await page.waitForTimeout(2500)
await page.evaluate(() => { const el = document.querySelector('#ascent'); window.scrollTo(0, el.offsetTop + el.offsetHeight - innerHeight) })
await page.waitForTimeout(3500)
const data = await page.evaluate(() => document.querySelector('[data-print]').toDataURL('image/png'))
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'))
await browser.close()
