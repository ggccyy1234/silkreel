import { rm } from 'node:fs/promises'
import path from 'node:path'
import { compileTimeline } from '../packages/choreo/src/index.js'
import type { FilmConfig } from '../packages/choreo/src/index.js'
import { renderFilm } from '../packages/render-api/src/render-film.js'
import { loadDemoBoard, defaultFilmConfig } from '../packages/render-api/src/boards.js'

const root = path.resolve(import.meta.dirname, '..')
const [boardName, outName] = [process.argv[2] ?? 'video', process.argv[3]]
const demoId = path.basename(boardName, '.kicad_pcb')
const out = path.join(root, 'exports', outName ?? `${demoId}-loop.mp4`)
const board = await loadDemoBoard(demoId)
const config: FilmConfig = { ...defaultFilmConfig(demoId), style: 'glyph', knobs: { density: 1, texts: 1 } }
const t0 = Date.now()
const timeline = compileTimeline(board, config)
console.log(`${demoId}: ${timeline.totalFrames}f ${timeline.durationSeconds.toFixed(1)}s cast=${timeline.cast.length} placements=${timeline.style === 'glyph' ? timeline.placements.length : 0} compile=${Date.now()-t0}ms`)
for (const w of timeline.warnings) console.log(`  warn[${w.code}] ${w.message}`)
let bundle: string | undefined
try {
  const r = await renderFilm({ inputProps: { timeline }, outputLocation: out, onProgress: (p) => process.stdout.write(`\rrender ${p}%`) })
  bundle = r.bundleLocation
  console.log(`\n-> ${r.outputLocation}`)
} finally { if (bundle) await rm(bundle, { recursive: true, force: true }) }
