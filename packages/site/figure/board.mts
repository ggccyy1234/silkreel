// Dumps the iCEBreaker's top copper for the footer figure's board: `npx tsx packages/site/figure/board.mts`
import { readFileSync, writeFileSync } from 'node:fs'
import { parseKicadPcb } from '@silk-reel/ingest'

const board = parseKicadPcb(readFileSync('fixtures/boards/icebreaker.kicad_pcb', 'utf8'), 'icebreaker')
const r = (n: number) => Math.round(n * 100) / 100
const top = board.copper['F.Cu']
if (!top) throw new Error('no F.Cu')
const out = {
  bbox: board.bbox,
  outline: board.outline.map((p) => p.points.map((q) => [r(q.x), r(q.y)])),
  traces: top.traces.map((t) => ({ w: r(t.width), p: t.points.map((q) => [r(q.x), r(q.y)]) })),
  pads: top.pads.map((p) => ({ x: r(p.pos.x), y: r(p.pos.y), w: r(p.size.x), h: r(p.size.y), rot: p.rot, round: p.shape === 'circle' || p.shape === 'oval', ref: p.footprintRef })),
  vias: top.vias.map((v) => [r(v.pos.x), r(v.pos.y), r(v.dia)]),
  parts: board.footprints.filter((f) => f.layer === 'F.Cu').map((f) => ({ ref: f.ref, x: r(f.pos.x), y: r(f.pos.y) })),
}
writeFileSync('packages/site/figure/board.json', JSON.stringify(out))
console.log(board.bbox, out.traces.length, out.pads.length, out.vias.length, out.parts.length, out.outline.length)
