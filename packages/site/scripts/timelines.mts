// Precompiles every fixture's glyph film at every aspect into public/films/glyph/<board>-<aspect>.json,
// so the page loads a small timeline instead of a whole board. Run from the repo root: npx tsx packages/site/scripts/timelines.mts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { ASPECT_SIZE, compileTimeline, DEMO_CAST_HINTS } from '@silk-reel/choreo'
import type { Aspect } from '@silk-reel/choreo'
import { parseKicadPcb } from '@silk-reel/ingest'

const BOARDS = ['icebreaker', 'glasgow', 'StickHub', 'ecc83-pp', 'kit-dev-coldfire-xilinx_5213', 'video']
const out = 'packages/site/public/films/glyph'
mkdirSync(out, { recursive: true })
const round = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v)
for (const id of BOARDS) {
  const board = parseKicadPcb(readFileSync(`fixtures/boards/${id}.kicad_pcb`, 'utf8'), `${id}.kicad_pcb`)
  for (const aspect of Object.keys(ASPECT_SIZE) as Aspect[]) {
    const tl = compileTimeline(board, {
      style: 'glyph', aspect, knobs: { density: 1, tempo: 1, texts: 1 }, duration: 'auto', seed: 42,
      output: { ...ASPECT_SIZE[aspect], fps: 30 }, ...(DEMO_CAST_HINTS[board.source.boardName] ? { cast: DEMO_CAST_HINTS[board.source.boardName] } : {})
    } as never)
    const json = JSON.stringify(tl, round)
    const file = `${out}/${id}-${aspect.replace(':', 'x')}.json`
    writeFileSync(file, json)
    console.log(file, (json.length / 1024).toFixed(0), 'KB', (gzipSync(json).length / 1024).toFixed(0), 'KB gz')
  }
}

// the lit board the page renders live under its own camera: one trace timeline per hero board
const traceOut = 'packages/site/public/films/trace'
mkdirSync(traceOut, { recursive: true })
const near = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)
for (const id of ['icebreaker']) {
  const board = parseKicadPcb(readFileSync(`fixtures/boards/${id}.kicad_pcb`, 'utf8'), `${id}.kicad_pcb`)
  const tl = compileTimeline(board, {
    style: 'trace', aspect: '16:9', knobs: { density: 1, tempo: 1, texts: 1 }, duration: 'auto', seed: 42,
    output: { ...ASPECT_SIZE['16:9'], fps: 30 }, ...(DEMO_CAST_HINTS[board.source.boardName] ? { cast: DEMO_CAST_HINTS[board.source.boardName] } : {})
  } as never)
  const json = JSON.stringify(tl, near)
  const file = `${traceOut}/${id}.json`
  writeFileSync(file, json)
  console.log(file, (json.length / 1024).toFixed(0), 'KB', (gzipSync(json).length / 1024).toFixed(0), 'KB gz')
}
