// Dumps a board for the drawing sheet: `npx tsx packages/site/figure/blueprint.mts [board]` from the repo root.
// Writes src/blueprint/<board>.json. With NEWSTROKE=<path to KiCad's common/newstroke_font.cpp> it also rewrites
// src/blueprint/newstroke.json (ASCII and Latin-1 glyphs).
import { readFileSync, writeFileSync } from 'node:fs'
import { parseKicadPcb } from '@silk-reel/ingest'
import { extractParts } from '../../choreo/src/trace/parts'

const NAME = process.argv[2] ?? 'glasgow'
const OUT = 'packages/site/src/blueprint'
const SRC = readFileSync(`fixtures/boards/${NAME}.kicad_pcb`, 'utf8')
const board = parseKicadPcb(SRC, NAME)
const r = (n: number) => Math.round(n * 100) / 100
const flat = (pts: { x: number; y: number }[]) => pts.flatMap((p) => [r(p.x), r(p.y)])
const field = (key: string) => SRC.match(new RegExp(`\\(${key} "([^"]*)"`))?.[1]

const stack = [...SRC.matchAll(/\(layer "([^"]+)" \(type "([^"]+)"\)[^\n]*?\(thickness ([\d.]+)\)(?:[^\n]*?\(material "([^"]+)"\))?/g)]
  .flatMap(([, name, type, t, material]) => (name && type ? [{ name, type, t: Number(t), ...(material ? { material } : {}) }] : []))
const copperOrder = ['F.Cu', ...Object.keys(board.copper).filter((k) => /^In\d+\.Cu$/.test(k)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2))), 'B.Cu']

const data = {
  name: NAME,
  title: field('title') ?? null,
  rev: field('rev') ?? null,
  company: field('company') ?? null,
  thickness: board.stackup.thickness,
  finish: board.stackup.finish ?? null,
  mask: board.stackup.maskColor ?? null,
  stats: { pads: board.stats.pads, traces: board.stats.traces, nets: board.nets.length },
  stack,
  outline: board.outline.map((o) => flat(o.points)),
  holes: board.drill.map((d) => [r(d.pos.x), r(d.pos.y), r(d.dia), d.plated ? 1 : 0]),
  parts: extractParts(board).map((p) => ({ ref: p.ref, value: p.value ?? '', x: r(p.pos.x), y: r(p.pos.y), w: r(p.w), h: r(p.h), rot: p.rot, z: r(p.z), kind: p.kind, back: p.back, pads: p.pads, pitch: r(p.pitch) })),
  copper: copperOrder.flatMap((k) => {
    const c = board.copper[k]
    return c ? [{
      layer: k,
      traces: c.traces.map((t) => [r(t.width), ...flat(t.points)]),
      zones: c.zones.flatMap((z) => z.fills.map(flat)),
      pads: c.pads.map((p) => [r(p.pos.x), r(p.pos.y), r(p.size.x), r(p.size.y), p.rot, p.shape === 'circle' || p.shape === 'oval' ? 1 : 0, p.footprintRef ?? '']),
    }] : []
  }),
  vias: (board.copper['F.Cu']?.vias ?? []).map((v) => [r(v.pos.x), r(v.pos.y), r(v.dia), r(v.drill)]),
}
writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify(data))

// newstroke: CC0 1.0, Vladimir Lapygin (vovanium). KiCad compiles it to a Hershey-encoded table, one string per code point,
// with a code-point comment every sixteenth entry.
if (process.env.NEWSTROKE) {
  const NS = readFileSync(process.env.NEWSTROKE, 'utf8')
  const glyphs: Record<number, string> = {}
  let cp = 31
  for (const m of NS.slice(NS.indexOf('newstroke_font[]'), NS.indexOf('U+300 ')).matchAll(/^\s*"((?:[^"\\]|\\.)*)",(?:\s*\/\* U\+([0-9A-F]+))?/gm)) {
    cp = m[2] ? parseInt(m[2], 16) : cp + 1
    const g = m[1]
    if (g !== undefined && (cp < 0x7f || (cp >= 0xa0 && cp <= 0xff))) glyphs[cp] = g.replace(/\\(.)/g, '$1')
  }
  writeFileSync(`${OUT}/newstroke.json`, JSON.stringify(glyphs))
}
console.log(NAME, (JSON.stringify(data).length / 1024).toFixed(0) + ' KB')
