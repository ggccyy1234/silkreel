// The shoot's phone probe on SwiftShader (software WebGL): 390×844 at 2×, 4× CPU slowdown, scrollBy 6 px a frame for 2.5 s, from the top
import { launch } from '/Users/hridyaagrawal/.agents/skills/jury/scripts/browser.mjs'
const url = process.argv[2] ?? 'http://localhost:4400/'
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.text().startsWith('SLOW')) console.log(m.text()) })
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
await page.goto(url)
if (process.env.CSS) await page.addStyleTag({ content: process.env.CSS })
await page.waitForTimeout(+(process.env.WAIT ?? 6000))
const probe = () => page.evaluate(() => new Promise((res) => {
  let n = 0; let worst = 0; let at = 0; const t0 = performance.now(); let last = t0; const long = []
  const f = (t) => { n++; if (t - last > 100) long.push([Math.round(t - last), Math.round(scrollY)]); worst = Math.max(worst, t - last); last = t; scrollBy(0, 6); if (t - t0 < 2500) requestAnimationFrame(f); else res({ fps: Math.round((n * 1000) / (t - t0)), worstFrameMs: Math.round(worst), y: Math.round(scrollY), long }) }
  requestAnimationFrame(f)
}))
if (process.env.PRE) { await page.evaluate((y) => scrollTo(0, y), +process.env.PRE); await page.waitForTimeout(4000) }
const prof = process.argv.includes('--profile')
if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start') }
console.log('top', JSON.stringify(await probe()))
if (prof) {
  const { profile } = await cdp.send('Profiler.stop')
  const self = new Map()
  const dt = profile.timeDeltas; const ids = profile.samples
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  ids.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000) })
  console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${Math.round(v)}ms ${k}`).join('\n'))
}
await browser.close()
