import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { findBrowser } from './render.js'
import { buildViewer } from './web.js'
import type { ViewSettings } from './types.js'

async function main(): Promise<void> {
  const out = path.resolve(process.argv[2] ?? 'exports/cad/step')
  const url = process.argv[3] ?? 'http://127.0.0.1:3103'
  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8')) as { render?: { duration: number; width: number; height: number } }
  const expected = manifest.render
  if (!expected?.duration) throw new Error('Smoke playback needs an already rendered video')
  await buildViewer(out)
  const review = path.join(out, 'review')
  await mkdir(review, { recursive: true })
  const browser = await chromium.launch({ executablePath: await findBrowser(), headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.waitForFunction(() => window.cadReady || window.cadError, undefined, { timeout: 120000 })
    const error = await page.evaluate(() => window.cadError)
    if (error) throw new Error(error)
    await page.screenshot({ path: path.join(review, 'viewer.png') })
    for (const view of ['bottom', 'top', 'iso']) {
      await page.locator(`[data-view="${view}"]`).click()
      await page.screenshot({ path: path.join(review, `viewer-${view}.png`) })
    }
    await page.locator('#play').click()
    if (await page.locator('#play').textContent() !== '暂停') throw new Error('Turntable did not start')
    await page.locator('#play').click()
    if (await page.locator('#play').textContent() !== '转台') throw new Error('Turntable did not stop')
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()])
    if (download.suggestedFilename() !== 'pcb-cad.png') throw new Error('PNG download failed')
    const response = await page.request.get(`${url}/.cad-cache/source.kicad_pcb`)
    if (response.status() !== 404) throw new Error('Private cache exposed by viewer server')
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`${url}/?render`)
    await page.waitForFunction(() => window.cadReady || window.cadError, undefined, { timeout: 120000 })
    const settings: ViewSettings = { width: 1920, height: 1080, azimuth: -90, elevation: 89.99,
      side: 'bottom', background: '#edf0f4', transparent: false, title: '' }
    await page.evaluate(view => { if (!window.cadFrame) throw new Error('Missing renderer'); window.cadFrame(0, view) }, settings)
    await page.screenshot({ path: path.join(review, 'render-bottom.png') })
    await page.setContent(`<video controls autoplay src="${url}/turntable.mp4" style="width:100%"></video>`)
    await page.waitForFunction(() => document.querySelector('video')?.ended, undefined, { timeout: Math.max(30000, expected.duration * 1000 + 10000) })
    const duration = await page.locator('video').evaluate(element => {
      if (!(element instanceof HTMLVideoElement)) throw new Error('Missing video element')
      return { duration: element.duration, time: element.currentTime, width: element.videoWidth, height: element.videoHeight }
    })
    if (Math.abs(duration.time - expected.duration) > 0.1 || duration.width !== expected.width || duration.height !== expected.height) throw new Error('Full video playback failed')
    if (errors.length) throw new Error(errors.join('\n'))
    process.stdout.write(`Viewer, side controls, turntable, PNG download, cache isolation and full video playback passed: ${JSON.stringify(duration)}\n`)
  } finally { await browser.close() }
}
void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1 })
