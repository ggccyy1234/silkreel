// Writes public/og.png (1200×630): the live print of the board near plan view, with the SILK REEL wordmark set in its dark floor.
// usage: node scripts/og.mjs <url of the built site> [ascent fraction]
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const [url = 'http://localhost:4400/', at = '0.8'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto(url)
await page.waitForTimeout(2500)
await page.evaluate((f) => {
  const el = document.querySelector('#ascent')
  window.scrollTo(0, el.offsetTop + (el.offsetHeight - innerHeight) * Number(f))
}, at)
await page.addStyleTag({ content: `
  [data-header], .ascent__pin, .tags, .loupe, astro-dev-toolbar { display: none !important }
  .og { position: fixed; inset: auto 0 0 0; z-index: 50; padding: 0 28px 22px; display: grid; gap: 14px; color: var(--safe) }
  .og p:first-child { font-family: var(--f-display); font-weight: 600; font-size: 40px; letter-spacing: -0.045em; line-height: 1 }
  .og .mark-word { font-size: 150px; margin: 0; translate: none }
` })
await page.evaluate(() => {
  const og = document.createElement('div')
  og.className = 'og'
  og.innerHTML = '<p>KiCad in. Film out.</p><p class="mark-word">SILK REEL</p>'
  document.body.append(og)
})
await page.waitForTimeout(3500)
await page.screenshot({ path: `${root}public/og.png` })
await browser.close()
