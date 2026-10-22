// Interaction stills: node scripts/interact.mjs <url> <outdir>
// wake, deck chip hover and board swap, ink pick, arrow keys in a radiogroup, keyboard focus walk
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const [url, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('pageerror', e.message))
let n = 0
const shot = (name) => page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}-${name}.png` })
const to = (sel, f = 0) => page.evaluate(([s, fr]) => {
  const el = document.querySelector(s)
  window.scrollTo(0, el.getBoundingClientRect().top + scrollY + Math.max(0, el.offsetHeight - innerHeight) * fr)
}, [sel, f])
// role and accessible name as the accessibility tree has them, plus where the focus is and how it shows
const focused = async () => {
  const name = (await page.locator('*:focus').ariaSnapshot().catch(() => '')).split('\n')[0].replace(/^- /, '').replace(/:$/, '')
  const box = await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return `@${Math.round(r.top)} outline=${cs.outlineStyle} shadow=${cs.boxShadow === 'none' ? 'none' : 'yes'}` })
  return `${name} ${box}`
}
await page.goto(url)
await page.waitForTimeout(3000)
await to('#ascent', 0.3); await page.waitForTimeout(1500)
await page.mouse.move(700, 300); await page.waitForTimeout(900)
await shot('wake')
await to('#film', 0.3); await page.waitForTimeout(1500)
// the film stage across its loop: four moments, about three seconds apart
for (let i = 0; i < 4; i++) { await page.screenshot({ path: `${out}/film-loop-${i * 2}.png`, clip: { x: 560, y: 80, width: 880, height: 820 } }); await page.waitForTimeout(2800) }
await page.hover('[data-board="glasgow"]'); await page.waitForTimeout(300)
await shot('chip-hover')
await page.click('[data-board="glasgow"]'); await page.waitForTimeout(1800)
await shot('board-glasgow')
await page.click('[data-ink-pick="blueprint"]'); await page.waitForTimeout(500)
await shot('ink-blueprint')
// arrow keys move the choice inside a radiogroup
await page.focus('[data-aspect="4:5"]')
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900)
console.log('arrow ->', await focused())
await shot('aspect-arrow')
await page.click('[data-ink-pick="mono"]'); await page.click('[data-board="icebreaker"]'); await page.click('[data-aspect="4:5"]')
await page.waitForTimeout(600)
await page.goto(url); await page.waitForTimeout(2500)
const stops = []
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Tab'); await page.waitForTimeout(300)
  stops.push(`${i} ${await focused()}`)
  if ([0, 2, 5, 9, 14].includes(i)) await shot(`tab-${i}`)
}
console.log(stops.join('\n'))
await browser.close()
