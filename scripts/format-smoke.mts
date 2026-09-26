#!/usr/bin/env tsx
// Renders glasgow (trace, 4:5) in every output format to /tmp/fmt and prints ffprobe facts.
// usage: npx tsx scripts/format-smoke.mts
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { compileTimeline } from '../packages/choreo/src/index.js'
import { loadDemoBoard, defaultFilmConfig } from '../packages/render-api/src/boards.js'
import { FORMAT_EXT, OUTPUT_FORMATS, isAlphaFormat, renderFilm } from '../packages/render-api/src/render-film.js'

const out = '/tmp/fmt'
mkdirSync(out, { recursive: true })
const board = await loadDemoBoard('glasgow')
let bundleLocation: string | undefined
for (const format of OUTPUT_FORMATS) {
  const config = { ...defaultFilmConfig('glasgow'), style: 'trace' as const, aspect: '4:5' as const, seed: 42, transparent: isAlphaFormat(format) }
  const timeline = compileTimeline(board, config)
  const file = `${out}/glasgow.${FORMAT_EXT[format]}`
  const t0 = Date.now()
  const r = await renderFilm({
    ...(bundleLocation !== undefined ? { bundleLocationOverride: bundleLocation } : {}),
    inputProps: { timeline },
    outputLocation: file,
    format
  })
  bundleLocation = r.bundleLocation
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,pix_fmt,width,height:stream_tags=alpha_mode', '-of', 'csv=p=0', file]).toString().trim()
  console.log(`${format}: ${probe} (${Date.now() - t0}ms) -> ${file}`)
}
