// Records a page's first nine seconds as WebM into /tmp/g321/<name>: node scripts/intro-rec.mjs <url> <name> <width> <height>
import { chromium } from 'playwright'
const [url, name, w, h] = process.argv.slice(2)
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, recordVideo: { dir: `/tmp/g321/${name}`, size: { width: +w, height: +h } } })
const p = await ctx.newPage()
await p.goto(url, { waitUntil: 'commit' }).catch(() => {})
await p.waitForTimeout(9000)
await ctx.close(); await b.close()
