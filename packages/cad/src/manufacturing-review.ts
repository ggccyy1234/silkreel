import { chromium } from 'playwright'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { findBrowser } from './render.js'
import { manufacturingPlan } from './manufacturing-plan.js'
import type { ManufacturingData } from './manufacturing.js'
import type { ViewSettings } from './types.js'

async function main(): Promise<void> {
  const out = path.resolve(process.argv[2] ?? 'exports/cad/manufacturing')
  const url = process.argv[3] ?? 'http://127.0.0.1:3104'
  const review = path.join(out, 'review')
  await mkdir(review, { recursive: true })
  const data = JSON.parse(await readFile(path.join(out, 'manufacturing.json'), 'utf8')) as ManufacturingData
  const plan = manufacturingPlan(data)
  const browser = await chromium.launch({ executablePath: await findBrowser(), headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}/?render`)
    await page.waitForFunction(() => window.cadReady || window.cadError, undefined, { timeout: 120000 })
    const loadError = await page.evaluate(() => window.cadError)
    if (loadError) throw new Error(loadError)
    const settings: ViewSettings = { width: 1920, height: 1080, azimuth: -45, elevation: 42, side: 'top', background: '#edf0f4', transparent: false, title: '', film: true }
    for (const [index, stage] of plan.stages.entries()) {
      await page.evaluate(({ t, duration, settings }) => { window.cadFrame?.(t / duration, settings) }, { t: stage[0] + 1, duration: plan.duration, settings })
      await page.screenshot({ path: path.join(review, `stage-${String(index + 1).padStart(2, '0')}.png`) })
    }
    for (const t of [0, 9, plan.duration, 19, plan.duration, 0]) {
      const state = await page.evaluate(({ t, duration, settings }) => { window.cadFrame?.(t / duration, settings); return window.cadAssemblyState?.() }, { t, duration: plan.duration, settings })
      if (!state || ((t === 0 || t === plan.duration) && state.translated !== 0) || (t === 9 && state.translated === 0)) throw new Error(`Invalid assembly state at ${t}: ${JSON.stringify(state)}`)
    }
    if (errors.length) throw new Error(errors.join('\n'))
    process.stdout.write(`Captured ${plan.stages.length} stages; exact assembly positions restored at both endpoints, including nonsequential seeking.\n`)
  } finally { await browser.close() }
}
void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1 })
