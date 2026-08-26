import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseKicadPcb } from '@silk-reel/ingest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig } from '@silk-reel/choreo'
import { renderFilm } from '../render-film.js'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const outPath = path.join(repoRoot, 'fixtures', 'canonical.mp4')

const boardPath = path.join(repoRoot, 'fixtures', 'boards', 'ecc83-pp.kicad_pcb')
const board = parseKicadPcb(await readFile(boardPath, 'utf8'), 'ecc83-pp.kicad_pcb')
const config: FilmConfig = {
  actOrder: [],
  knobs: {},
  seed: 42,
  duration: 'auto',
  output: { width: 1080, height: 1350, fps: 15 }
}
const timeline = compileTimeline(board, config)

console.log(`compiling done: ${timeline.totalFrames} frames @ ${timeline.fps}fps`)
const result = await renderFilm({
  inputProps: { timeline, board },
  outputLocation: outPath,
  onProgress: (pct) => console.log(`render ${pct}%`)
})
console.log('canonical render complete:', result.outputLocation)
