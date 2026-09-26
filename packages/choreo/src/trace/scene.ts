import type { Arc, BoardModel, Pad, Vec2 } from '@silk-reel/ingest'
import { fitBoard, safeArea } from '../layout'
import type { ResolvedConfig } from '../config'
import type { CameraKey, FlatPath, TraceBeats, TraceLayer, TracePad, TraceScene, TraceText, TraceVia, TraceZone, TimelineWarning } from '../types'
import { growthSchedule } from './graph'
import type { GraphLink, GraphSeg, GraphSeed } from './graph'
import { pickHero } from './hero'

export const TRACE_BEATS: TraceBeats = {
  outline: [0, 0.1],
  pads: [0.04, 0.24],
  growth: [0.07, 0.72],
  zones: [0.6, 0.76],
  silk: [0.68, 0.84],
  hold: [0.82, 0.96],
  fade: [0.96, 1]
}

const DEG = Math.PI / 180
/** wrap a text rotation into (−π/2, π/2] — text reads the same upside-down */
const upright = (r: number): number => {
  const m = ((r % Math.PI) + Math.PI) % Math.PI
  return m > Math.PI / 2 ? m - Math.PI : m
}
const SIDE_DELAY = { F: 0, inner: 0.05, B: 0.08 } as const
const SIDE_ORDER = { inner: 0, B: 1, F: 2 } as const

type Side = 'F' | 'B' | 'inner'

const sideOf = (layerId: string): Side =>
  layerId.startsWith('F.') ? 'F' : layerId.startsWith('B.') ? 'B' : 'inner'

const flat = (pts: Vec2[], map: (p: Vec2) => Vec2): FlatPath => {
  const out: number[] = []
  for (const p of pts) {
    const m = map(p)
    out.push(m.x, m.y)
  }
  return out
}

const arcPoints = (arc: Arc, steps = 16): Vec2[] => {
  let sweep = arc.endAngle - arc.startAngle
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep < -Math.PI) sweep += 2 * Math.PI
  if (sweep === 0) sweep = 2 * Math.PI
  const out: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const a = arc.startAngle + (sweep * i) / steps
    out.push({ x: arc.center.x + arc.radius * Math.cos(a), y: arc.center.y + arc.radius * Math.sin(a) })
  }
  return out
}

const padShape = (pad: Pad): TracePad['shape'] => {
  const w = pad.size.x
  const h = pad.size.y
  if (pad.shape === 'circle' || (pad.shape === 'oval' && Math.abs(w - h) < 0.01 * Math.max(w, h))) return 'circle'
  if (pad.shape === 'roundrect' || pad.shape === 'oval') return 'round'
  return 'rect'
}

export function buildTraceScene(board: BoardModel, resolved: ResolvedConfig): { scene: TraceScene; warnings: TimelineWarning[] } {
  const beats = TRACE_BEATS
  const [g0, g1] = beats.growth
  const fit = fitBoard(board.bbox, resolved.width, resolved.height, resolved.title !== undefined)
  const hero = pickHero(board, resolved.cast)
  const originMm = hero?.center ?? {
    x: (board.bbox.min.x + board.bbox.max.x) / 2,
    y: (board.bbox.min.y + board.bbox.max.y) / 2
  }

  const segs: GraphSeg[] = []
  const segLen: number[] = []
  const links: GraphLink[] = []
  const linkVia = new Map<string, number>()
  const padLayerSets = new Map<string, { pad: Pad; sides: Set<Side> }>()
  const copperEntries = Object.entries(board.copper)
  for (const [layerId, copper] of copperEntries) {
    for (const trace of copper.traces) {
      for (let i = 0; i + 1 < trace.points.length; i++) {
        const a = trace.points[i] as Vec2
        const b = trace.points[i + 1] as Vec2
        segs.push({ layer: layerId, a, b, width: trace.width })
        segLen.push(Math.hypot(b.x - a.x, b.y - a.y))
      }
    }
    for (const via of copper.vias) {
      if (linkVia.has(via.id)) continue
      linkVia.set(via.id, links.length)
      links.push({ pos: via.pos, r: Math.max(0.05, via.dia / 2) })
    }
    for (const pad of copper.pads) {
      const rec = padLayerSets.get(pad.id)
      if (rec !== undefined) rec.sides.add(sideOf(layerId))
      else padLayerSets.set(pad.id, { pad, sides: new Set([sideOf(layerId)]) })
    }
  }
  // through-hole pads bridge every copper layer they touch
  for (const { pad, sides } of padLayerSets.values()) {
    if (sides.size >= 2) links.push({ pos: pad.pos, r: Math.max(pad.size.x, pad.size.y) / 2 })
  }

  const seeds: GraphSeed[] = (hero?.pads ?? []).map((p) => ({ layer: p.layer, pos: p.pos }))
  const g = growthSchedule(segs, links, seeds, originMm)
  const md = Math.max(1e-9, g.maxDist)

  // schedule by rank, not raw distance — a long tail of distant stragglers
  // would otherwise hog the growth window while heads trickle. rank keeps
  // the visible head count roughly constant; distance still breaks ties and
  // preserves the outward wavefront ordering inside each rank bucket
  const order = segs.map((_, i) => i).sort((a, b) => (g.start[a] as number) - (g.start[b] as number))
  const rank = new Array<number>(segs.length)
  order.forEach((segIdx, r) => {
    rank[segIdx] = r / Math.max(1, segs.length - 1)
  })

  const rowsByLayer = new Map<string, { side: Side; rows: number[][] }>()
  const segT0 = new Array<number>(segs.length)
  // side delays stagger sides against each other; a back-only board still starts on time
  const delay0 = Math.min(...segs.map((s) => SIDE_DELAY[sideOf(s.layer)]))
  segs.forEach((s, i) => {
    const side = sideOf(s.layer)
    const u = 0.7 * (rank[i] as number) + 0.3 * Math.min(1, (g.start[i] as number) / md)
    const t0 = Math.min(g1, g0 + u * (g1 - g0 - 0.06) + SIDE_DELAY[side] - delay0)
    segT0[i] = t0
    const dur = Math.max(0.004, Math.min(0.12 * (g1 - g0), Math.pow((segLen[i] as number) / md, 0.85) * (g1 - g0)))
    const t1 = Math.min(g1, t0 + dur)
    const ends = g.flipped[i] === true ? [s.b, s.a] : [s.a, s.b]
    const a = fit.map(ends[0] as Vec2)
    const b = fit.map(ends[1] as Vec2)
    let rec = rowsByLayer.get(s.layer)
    if (rec === undefined) {
      rec = { side, rows: [] }
      rowsByLayer.set(s.layer, rec)
    }
    rec.rows.push([a.x, a.y, b.x, b.y, Math.max(0.9, s.width * fit.scale), t0, t1])
  })
  const layers: TraceLayer[] = [...rowsByLayer.entries()]
    .map(([id, rec]) => ({ id, side: rec.side, rows: rec.rows }))
    .sort((x, y) => SIDE_ORDER[x.side] - SIDE_ORDER[y.side])
    .map(({ id, side, rows }) => ({
      id,
      side,
      segs: rows.sort((x, y) => (x[5] as number) - (y[5] as number)).flat()
    }))

  const [p0] = beats.pads
  const pads: TracePad[] = []
  let padDMax = 1e-9
  for (const { pad } of padLayerSets.values()) {
    padDMax = Math.max(padDMax, Math.hypot(pad.pos.x - originMm.x, pad.pos.y - originMm.y))
  }
  // a pad pops when the growth wavefront touches it — the earliest t0 of a
  // seg ending inside the pad, a beat early; pads no copper reaches keep a
  // distance-ordered pop squeezed into the growth window
  const touchedT = (pad: Pad): number => {
    const r = Math.max(pad.size.x, pad.size.y) / 2 + 0.05
    let best = Infinity
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i] as GraphSeg
      const ta = Math.hypot(s.a.x - pad.pos.x, s.a.y - pad.pos.y) <= r
      const tb = Math.hypot(s.b.x - pad.pos.x, s.b.y - pad.pos.y) <= r
      if ((ta || tb) && (segT0[i] as number) < best) best = segT0[i] as number
    }
    return best
  }
  // mounting holes sit in copper layers but are really drills — plated:false
  // marks them; oversized pads draw as rings either way so they never blob
  const npth = board.drill.filter((d) => !d.plated)
  const drillOnly = (pad: Pad): boolean =>
    npth.some((d) => Math.hypot(d.pos.x - pad.pos.x, d.pos.y - pad.pos.y) < 0.05)
  const pxMin = Math.min(resolved.width, resolved.height)
  for (const { pad, sides } of padLayerSets.values()) {
    const d = Math.hypot(pad.pos.x - originMm.x, pad.pos.y - originMm.y)
    const isHero = hero !== undefined && pad.footprintRef === hero.ref
    const touch = touchedT(pad)
    const t = isHero
      ? p0
      : Number.isFinite(touch)
        ? Math.min(g1, Math.max(p0, touch - 0.01))
        : g0 + (d / padDMax) * (g1 - g0 - 0.06)
    const m = fit.map(pad.pos)
    pads.push({
      x: m.x,
      y: m.y,
      w: Math.max(1.5, pad.size.x * fit.scale),
      h: Math.max(1.5, pad.size.y * fit.scale),
      rot: pad.rot * DEG + (fit.rotated ? Math.PI / 2 : 0),
      shape: padShape(pad),
      t,
      side: sides.size > 1 ? 'both' : ([...sides][0] === 'F' ? 'F' : 'B'),
      ring:
        Math.min(pad.size.x, pad.size.y) * fit.scale > 0.03 * pxMin ||
        drillOnly(pad)
    })
  }
  pads.sort((a, b) => a.t - b.t)

  const vias: TraceVia[] = []
  const seenVia = new Set<string>()
  for (const [, copper] of copperEntries) {
    for (const via of copper.vias) {
      if (seenVia.has(via.id)) continue
      seenVia.add(via.id)
      const lt = g.linkTime[linkVia.get(via.id) ?? -1] ?? Infinity
      const t = Number.isFinite(lt) ? g0 + Math.pow(Math.min(1, lt / md), 0.85) * (g1 - g0 - 0.06) : g0
      const m = fit.map(via.pos)
      vias.push({ x: m.x, y: m.y, r: Math.max(0.9, (via.dia / 2) * fit.scale), t })
    }
  }
  vias.sort((a, b) => a.t - b.t)

  const [z0, z1] = beats.zones
  const zoneSpans: Array<{ layer: Side; pts: Vec2[]; d: number }> = []
  let zoneDMax = 1e-9
  for (const [layerId, copper] of copperEntries) {
    for (const zone of copper.zones) {
      for (const fill of zone.fills) {
        if (fill.length < 3) continue
        let cx = 0
        let cy = 0
        for (const p of fill) {
          cx += p.x
          cy += p.y
        }
        cx /= fill.length
        cy /= fill.length
        const d = Math.hypot(cx - originMm.x, cy - originMm.y)
        zoneDMax = Math.max(zoneDMax, d)
        zoneSpans.push({ layer: sideOf(layerId), pts: fill, d })
      }
    }
  }
  const zones: TraceZone[] = zoneSpans.map((z) => {
    const s = z.d / zoneDMax
    const t0z = z0 + s * (z1 - z0) * 0.6
    const path = flat(z.pts, fit.map)
    path.push(path[0] as number, path[1] as number)
    return { fill: path, side: z.layer, t0: t0z, t1: z0 + s * (z1 - z0) * 0.6 + (z1 - z0) * 0.4 }
  })

  const outline: FlatPath[] = []
  if (board.outline.length > 0) {
    for (const path of board.outline) {
      if (path.points.length < 2) continue
      const f = flat(path.points, fit.map)
      if (path.closed) f.push(f[0] as number, f[1] as number)
      outline.push(f)
    }
  }
  if (outline.length === 0) {
    const { min, max } = board.bbox
    outline.push(flat([min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }, min], fit.map))
  }

  const [s0, s1] = beats.silk
  const silkRaw: Array<{ path: FlatPath; y: number }> = []
  for (const [layerId, silk] of Object.entries(board.silkscreen)) {
    if (sideOf(layerId) === 'inner') continue
    for (const line of silk.lines) {
      if (line.points.length < 2) continue
      const f = flat(line.points, fit.map)
      silkRaw.push({ path: f, y: meanY(f) })
    }
    for (const arc of silk.arcs) {
      const f = flat(arcPoints(arc), fit.map)
      silkRaw.push({ path: f, y: meanY(f) })
    }
  }
  silkRaw.sort((a, b) => a.y - b.y)
  const silkSpan = s1 - s0 - 0.05
  const silkStrokes = silkRaw.map((s, i) => ({
    path: s.path,
    t: s0 + (silkRaw.length > 1 ? (i / (silkRaw.length - 1)) * silkSpan : 0)
  }))

  const textRaw: Array<{ text: TraceText; y: number }> = []
  for (const [layerId, silk] of Object.entries(board.silkscreen)) {
    if (sideOf(layerId) === 'inner') continue
    for (const text of silk.texts) {
      if (text.mirrored) continue
      const value = text.value.trim()
      if (value.length < 1 || value.length > 24) continue
      const m = fit.map(text.pos)
      textRaw.push({
        y: m.y,
        text: {
          text: value,
          x: m.x,
          y: m.y,
          size: Math.max(9, text.height * fit.scale),
          // keep text upright: rot is mod π so a flipped board never draws it upside-down
          rot: upright(text.rot * DEG + (fit.rotated ? Math.PI / 2 : 0)),
          t: 0
        }
      })
    }
  }
  textRaw.sort((a, b) => a.y - b.y)
  const texts = textRaw.map((t, i) => ({
    ...t.text,
    t: s0 + 0.04 + (textRaw.length > 1 ? (i / (textRaw.length - 1)) * (s1 - s0 - 0.08) : 0)
  }))

  const drills = board.drill.map((d) => {
    const m = fit.map(d.pos)
    return { x: m.x, y: m.y, r: Math.max(0.8, (d.dia / 2) * fit.scale) }
  })

  const origin = hero !== undefined ? fit.map(hero.center) : { x: resolved.width / 2, y: resolved.height / 2 }
  const warnings: TimelineWarning[] = []
  if (segs.length === 0) warnings.push({ code: 'trace-no-copper', message: 'board has no copper segments to grow' })
  if (hero === undefined) warnings.push({ code: 'trace-no-hero', message: 'no hero footprint; growth ordered from board center' })

  return {
    scene: {
      outline,
      layers,
      pads,
      vias,
      drills,
      zones,
      silkStrokes,
      texts,
      origin,
      camera: cameraTrack(board, resolved, fit.map, layers, origin),
      beats
    },
    warnings
  }
}

/**
 * Boards that fill the frame get a gentle whole-film push. Boards that leave
 * it mostly empty (a 1:3 board in 4:5, a square board in 9:16) punch in on the
 * hero, ride the growth front at a zoom that fills the frame, then pull back
 * to the whole board for the hold — the reveal.
 */
function cameraTrack(
  board: BoardModel,
  resolved: ResolvedConfig,
  map: (p: Vec2) => Vec2,
  layers: TraceLayer[],
  origin: { x: number; y: number }
): CameraKey[] {
  const W = resolved.width
  const H = resolved.height
  const corners = [board.bbox.min, { x: board.bbox.max.x, y: board.bbox.min.y }, board.bbox.max, { x: board.bbox.min.x, y: board.bbox.max.y }].map(map)
  const bx0 = Math.min(...corners.map((c) => c.x))
  const bx1 = Math.max(...corners.map((c) => c.x))
  const by0 = Math.min(...corners.map((c) => c.y))
  const by1 = Math.max(...corners.map((c) => c.y))
  const safe = safeArea(W, H, resolved.title !== undefined)
  const fill = ((bx1 - bx0) * (by1 - by0)) / (safe.w * safe.h)
  const home = { cx: W / 2, cy: H / 2 }
  if (fill >= 0.55) return [{ t: 0, ...home, zoom: 1 }, { t: 1, ...home, zoom: 1.05 }]
  const zoom = Math.min(2.2, Math.max(1, 1 / Math.sqrt(fill)))
  const m = 0.04 * Math.min(W, H)
  // keep the zoomed window over the board (plus margin) on each axis
  const clampAxis = (c: number, lo: number, hi: number, half: number): number =>
    hi - lo + 2 * m <= 2 * half ? (lo + hi) / 2 : Math.min(hi + m - half, Math.max(lo - m + half, c))
  const clampKey = (cx: number, cy: number): { cx: number; cy: number } => ({
    cx: clampAxis(cx, bx0, bx1, W / 2 / zoom),
    cy: clampAxis(cy, by0, by1, H / 2 / zoom)
  })
  const [g0] = TRACE_BEATS.growth
  const STEP = 0.04
  const fronts: Array<{ t: number; x: number; y: number }> = []
  let last = { x: origin.x, y: origin.y }
  for (let t = g0; t < 0.8 - 1e-9; t += STEP) {
    let sx = 0
    let sy = 0
    let n = 0
    for (const layer of layers) {
      const segs = layer.segs
      for (let o = 0; o < segs.length; o += 7) {
        const t0 = segs[o + 5] as number
        if (t0 < t || t0 >= t + STEP) continue
        sx += ((segs[o] as number) + (segs[o + 2] as number)) / 2
        sy += ((segs[o + 1] as number) + (segs[o + 3] as number)) / 2
        n += 1
      }
    }
    if (n > 0) last = { x: sx / n, y: sy / n }
    fronts.push({ t: t + STEP / 2, ...last })
  }
  const smooth = fronts.map((f, i) => {
    const w = fronts.slice(Math.max(0, i - 1), i + 2)
    return { t: f.t, x: w.reduce((a, b) => a + b.x, 0) / w.length, y: w.reduce((a, b) => a + b.y, 0) / w.length }
  })
  return [
    { t: 0, ...home, zoom: 1 },
    { t: TRACE_BEATS.outline[0] + 0.07, ...home, zoom: 1 },
    { t: TRACE_BEATS.pads[0] + 0.07, ...clampKey(origin.x, origin.y), zoom },
    ...smooth.filter((f) => f.t > TRACE_BEATS.pads[0] + 0.07 && f.t < 0.78).map((f) => ({ t: f.t, ...clampKey(f.x, f.y), zoom })),
    { t: 0.8, ...clampKey(last.x, last.y), zoom },
    { t: 0.88, ...home, zoom: 1 },
    { t: 1, ...home, zoom: 1.03 }
  ]
}

function meanY(path: FlatPath): number {
  let sum = 0
  for (let i = 1; i < path.length; i += 2) sum += path[i] as number
  return sum / Math.max(1, path.length / 2)
}
