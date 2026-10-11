import type { Arc, BBox, BoardModel, Pad, Vec2 } from '@silk-reel/ingest'
import { fitBoard, safeArea } from '../layout'
import type { ResolvedConfig } from '../config'
import type {
  CameraKey, CameraShot, FlatPath, Palette, TraceActs, TraceBeats, TraceCallout, TraceGroup, TraceLayer, TraceMaterial,
  TracePad, TracePart, TraceScene, TraceText, TraceVia, TraceZone, TimelineWarning
} from '../types'
import { makeRng } from '../rng'
import { fitZoom } from './camera'
import { growthSchedule } from './graph'
import type { GraphLink, GraphSeg, GraphSeed } from './graph'
import { pickHero } from './hero'
import { bareName, groupNets } from './nets'
import { extractParts } from './parts'
import type { NetKind } from './nets'

/**
 * The score, in film phase. I ignition: the hero's pins light and the power
 * planes flood. II signal: nets grow by role — clocks first, buses and pairs
 * in lockstep, the rest outward. III stack: the layers lift apart and slam
 * home. IV hero: mask pours over, silk prints, a light passes, hold.
 */
export const TRACE_ACTS: TraceActs = {
  ignite: [0, 0.09],
  land: [0, 0.032],
  heroPads: [0.032, 0.07],
  flood: [0.05, 0.17],
  signal: [0.075, 0.5],
  explode: [0.515, 0.575],
  slam: [0.64, 0.662],
  mask: [0.69, 0.765],
  cure: [0.768, 0.79],
  silk: [0.785, 0.835],
  place: [0.825, 0.89],
  sweep: [0.9, 0.955]
}

/** the flat fallback renderer still reads beats; they follow the acts */
export const TRACE_BEATS: TraceBeats = {
  outline: [0, 0.1],
  pads: [TRACE_ACTS.heroPads[0], 0.3],
  growth: TRACE_ACTS.signal,
  zones: TRACE_ACTS.flood,
  silk: TRACE_ACTS.silk,
  hold: [0.9, 0.975],
  fade: [0.975, 1]
}

/** each role's start window and growth duration inside the signal act */
const ROLE_TIME: Record<NetKind, { start: [number, number]; d: [number, number] }> = {
  clock: { start: [0.075, 0.12], d: [0.05, 0.07] },
  bus: { start: [0.11, 0.28], d: [0.09, 0.12] },
  diff: { start: [0.1, 0.28], d: [0.07, 0.1] },
  signal: { start: [0.12, 0.4], d: [0.035, 0.09] },
  power: { start: [0.25, 0.4], d: [0.05, 0.09] },
  ground: { start: [0.28, 0.42], d: [0.05, 0.08] }
}

const MASK_ALBEDO: Record<string, string> = {
  green: '#0d3b22', black: '#0c0d0e', white: '#d8dbd4', blue: '#0f2a5c', red: '#5c1015',
  yellow: '#b79a16', purple: '#3a1a55', matte: '#121314'
}
const FINISH: Record<string, { albedo: string; rough: number }> = {
  enig: { albedo: '#e3bb6c', rough: 0.18 },
  'enepig': { albedo: '#e3bb6c', rough: 0.18 },
  hal: { albedo: '#d4d8dc', rough: 0.34 },
  'immersion silver': { albedo: '#dfe3e6', rough: 0.2 },
  'immersion tin': { albedo: '#c9cdd1', rough: 0.3 }
}

const DEG = Math.PI / 180
/** wrap a text rotation into (−π/2, π/2] — text reads the same upside-down */
const upright = (r: number): number => {
  const m = ((r % Math.PI) + Math.PI) % Math.PI
  return m > Math.PI / 2 ? m - Math.PI : m
}
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

/**
 * what reads as the board: its outline plus copper and part bodies hanging
 * past it (edge connectors). board.bbox also counts silk text and footprint
 * origins floating off the edge, which shrank boards like StickHub by ~30%
 */
function contentBox(board: BoardModel): BBox {
  const pts = board.outline.flatMap((path) => path.points)
  if (pts.length < 2) return board.bbox
  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  const add = (x: number, y: number, r = 0): void => {
    min.x = Math.min(min.x, x - r)
    min.y = Math.min(min.y, y - r)
    max.x = Math.max(max.x, x + r)
    max.y = Math.max(max.y, y + r)
  }
  for (const p of pts) add(p.x, p.y)
  for (const copper of Object.values(board.copper)) {
    for (const pad of copper.pads) add(pad.pos.x, pad.pos.y, Math.max(pad.size.x, pad.size.y) / 2)
    for (const trace of copper.traces) for (const p of trace.points) add(p.x, p.y)
    for (const via of copper.vias) add(via.pos.x, via.pos.y, via.dia / 2)
  }
  // footprint silk is the part's body (a connector overhanging the edge);
  // free silk and text off the edge is annotation
  const owned = new Set(board.footprints.flatMap((fp) => [...fp.silkRefs]))
  for (const silk of Object.values(board.silkscreen)) {
    for (const line of silk.lines) if (owned.has(line.id)) for (const p of line.points) add(p.x, p.y)
  }
  return { min, max }
}

export function buildTraceScene(board: BoardModel, resolved: ResolvedConfig, seed = 42): { scene: TraceScene; warnings: TimelineWarning[] } {
  const beats = TRACE_BEATS
  const acts = TRACE_ACTS
  const [g0, g1] = beats.growth
  const box = contentBox(board)
  const fit = fitBoard(box, resolved.width, resolved.height, resolved.title !== undefined)
  const hero = pickHero(board, resolved.cast)
  const originMm = hero?.center ?? {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2
  }
  // a hero on the back copper means the film is shot from the back: mirror
  // the board and swap its sides, so the back reads as the face
  const back = hero?.back === true
  const mirrorX = box.min.x + box.max.x
  const map = back ? (p: Vec2): Vec2 => fit.map({ x: mirrorX - p.x, y: p.y }) : fit.map
  const sideAt = (layerId: string): Side => {
    const s = sideOf(layerId)
    return back ? (s === 'F' ? 'B' : s === 'B' ? 'F' : s) : s
  }

  const segs: GraphSeg[] = []
  const segLen: number[] = []
  const segNet: Array<number | undefined> = []
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
        segNet.push(trace.netId)
      }
    }
    for (const via of copper.vias) {
      if (linkVia.has(via.id)) continue
      linkVia.set(via.id, links.length)
      links.push({ pos: via.pos, r: Math.max(0.05, via.dia / 2) })
    }
    for (const pad of copper.pads) {
      const rec = padLayerSets.get(pad.id)
      if (rec !== undefined) rec.sides.add(sideAt(layerId))
      else padLayerSets.set(pad.id, { pad, sides: new Set([sideAt(layerId)]) })
    }
  }
  // through-hole pads bridge every copper layer they touch
  for (const { pad, sides } of padLayerSets.values()) {
    if (sides.size >= 2) links.push({ pos: pad.pos, r: Math.max(pad.size.x, pad.size.y) / 2 })
  }

  const seeds: GraphSeed[] = (hero?.pads ?? []).map((p) => ({ layer: p.layer, pos: p.pos }))
  const g = growthSchedule(segs, links, seeds, originMm)
  const md = Math.max(1e-9, g.maxDist)

  const { groups: netGroups, groupOf } = groupNets(board.nets)
  const segGroup = segNet.map((n) => (n === undefined ? -1 : (groupOf.get(n) ?? -1)))
  const sched = scheduleGroups(netGroups.map((ng) => ng.kind), segs, segLen, segNet, segGroup, g.start, md, seed)

  // unnetted copper keeps the old rank-ordered wash, inside the signal act
  const loose = segs.map((_, i) => i).filter((i) => segGroup[i] === -1)
    .sort((a, b) => (g.start[a] as number) - (g.start[b] as number))
  const looseRank = new Map(loose.map((segIdx, r) => [segIdx, r / Math.max(1, loose.length - 1)]))

  const rowsByLayer = new Map<string, { side: Side; rows: number[][] }>()
  const segT0 = new Array<number>(segs.length)
  segs.forEach((s, i) => {
    const side = sideAt(s.layer)
    let t0: number
    let t1: number
    const timed = sched.segTime[i]
    if (timed !== undefined) {
      ;[t0, t1] = timed
    } else {
      const u = 0.7 * (looseRank.get(i) ?? 0) + 0.3 * Math.min(1, (g.start[i] as number) / md)
      t0 = Math.min(g1, ROLE_TIME.signal.start[0] + u * (ROLE_TIME.signal.start[1] - ROLE_TIME.signal.start[0]))
      t1 = Math.min(g1, t0 + Math.max(0.004, Math.min(0.06, Math.pow((segLen[i] as number) / md, 0.85) * (g1 - g0))))
    }
    segT0[i] = t0
    const ends = g.flipped[i] === true ? [s.b, s.a] : [s.a, s.b]
    const a = map(ends[0] as Vec2)
    const b = map(ends[1] as Vec2)
    let rec = rowsByLayer.get(s.layer)
    if (rec === undefined) {
      rec = { side, rows: [] }
      rowsByLayer.set(s.layer, rec)
    }
    rec.rows.push([a.x, a.y, b.x, b.y, Math.max(0.9, s.width * fit.scale), t0, t1, segGroup[i] as number])
  })
  const layers: TraceLayer[] = [...rowsByLayer.entries()]
    .map(([id, rec]) => ({ id, side: rec.side, rows: rec.rows }))
    .sort((x, y) => SIDE_ORDER[x.side] - SIDE_ORDER[y.side])
    .map(({ id, side, rows }) => {
      rows.sort((x, y) => (x[5] as number) - (y[5] as number))
      return { id, side, segs: rows.flatMap((r) => r.slice(0, 7)), groups: rows.map((r) => r[7] as number) }
    })

  const [p0] = beats.pads
  const pads: TracePad[] = []
  let padDMax = 1e-9
  for (const { pad } of padLayerSets.values()) {
    padDMax = Math.max(padDMax, Math.hypot(pad.pos.x - originMm.x, pad.pos.y - originMm.y))
  }
  // a pad pops when the growth wavefront touches it — the earliest t0 of a
  // seg ending inside the pad, a beat early; pads no copper reaches keep a
  // distance-ordered pop squeezed into the growth window
  // seg endpoints in a 1 mm grid: pads and vias look up who touches them
  const CELL = 1
  const ends = new Map<string, number[]>()
  const cellKey = (x: number, y: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`
  segs.forEach((s, i) => {
    for (const q of [s.a, s.b]) {
      const k = cellKey(q.x, q.y)
      const list = ends.get(k)
      if (list === undefined) ends.set(k, [i])
      else list.push(i)
    }
  })
  /** earliest t0 of a seg with an end within r of pos */
  const earliestAt = (pos: Vec2, r: number): number => {
    let best = Infinity
    const n = Math.ceil(r / CELL)
    const cx = Math.floor(pos.x / CELL)
    const cy = Math.floor(pos.y / CELL)
    for (let dx = -n; dx <= n; dx++) {
      for (let dy = -n; dy <= n; dy++) {
        for (const i of ends.get(`${cx + dx},${cy + dy}`) ?? []) {
          const s = segs[i] as GraphSeg
          if ((Math.hypot(s.a.x - pos.x, s.a.y - pos.y) <= r || Math.hypot(s.b.x - pos.x, s.b.y - pos.y) <= r) && (segT0[i] as number) < best) {
            best = segT0[i] as number
          }
        }
      }
    }
    return best
  }
  const touchedT = (pad: Pad): number => earliestAt(pad.pos, Math.max(pad.size.x, pad.size.y) / 2 + 0.05)
  // mounting holes sit in copper layers but are really drills — plated:false
  // marks them; oversized pads draw as rings either way so they never blob
  const npth = board.drill.filter((d) => !d.plated)
  const drillOnly = (pad: Pad): boolean =>
    npth.some((d) => Math.hypot(d.pos.x - pad.pos.x, d.pos.y - pad.pos.y) < 0.05)
  const pxMin = Math.min(resolved.width, resolved.height)
  const [hp0, hp1] = acts.heroPads
  for (const { pad, sides } of padLayerSets.values()) {
    const d = Math.hypot(pad.pos.x - originMm.x, pad.pos.y - originMm.y)
    const isHero = hero !== undefined && pad.footprintRef === hero.ref
    const touch = isHero ? Infinity : touchedT(pad)
    // the hero's pins light in one sweep around the package, pin 1 corner first
    const sweep = (Math.atan2(pad.pos.y - originMm.y, pad.pos.x - originMm.x) / (2 * Math.PI) + 1.375) % 1
    const t = isHero
      ? hp0 + sweep * (hp1 - hp0)
      : Number.isFinite(touch)
        ? Math.min(g1, Math.max(p0, touch - 0.01))
        : g0 + (d / padDMax) * (g1 - g0 - 0.06)
    const m = map(pad.pos)
    pads.push({
      x: m.x,
      y: m.y,
      w: Math.max(1.5, pad.size.x * fit.scale),
      h: Math.max(1.5, pad.size.y * fit.scale),
      rot: (back ? -pad.rot : pad.rot) * DEG + (fit.rotated ? Math.PI / 2 : 0),
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
      // a via lights when the first seg leaving it starts growing
      let t = earliestAt(via.pos, Math.max(0.05, via.dia / 2) + 0.05)
      if (!Number.isFinite(t)) {
        const lt = g.linkTime[linkVia.get(via.id) ?? -1] ?? Infinity
        t = Number.isFinite(lt) ? g0 + Math.pow(Math.min(1, lt / md), 0.85) * (g1 - g0 - 0.06) : g0
      }
      const m = map(via.pos)
      vias.push({ x: m.x, y: m.y, r: Math.max(0.9, (via.dia / 2) * fit.scale), t })
    }
  }
  vias.sort((a, b) => a.t - b.t)

  // power and ground pours flood in act I; a signal pour arrives with its net
  const [z0, z1] = acts.flood
  const zoneSpans: Array<{ layer: Side; pts: Vec2[]; d: number; group: number }> = []
  let zoneDMax = 1e-9
  for (const [layerId, copper] of copperEntries) {
    for (const zone of copper.zones) {
      const gi = zone.netId === undefined ? -1 : (groupOf.get(zone.netId) ?? -1)
      const kind = gi < 0 ? 'ground' : (netGroups[gi] as { kind: NetKind }).kind
      const group = kind === 'ground' || kind === 'power' ? -1 : gi
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
        zoneSpans.push({ layer: sideAt(layerId), pts: fill, d, group })
      }
    }
  }
  const zones: TraceZone[] = zoneSpans.map((z) => {
    const path = flat(z.pts, map)
    path.push(path[0] as number, path[1] as number)
    const grp = sched.groups[z.group]
    if (grp !== undefined) return { fill: path, side: z.layer, t0: grp.t, t1: grp.t + grp.d }
    const s = z.d / zoneDMax
    return { fill: path, side: z.layer, t0: z0 + s * (z1 - z0) * 0.6, t1: z0 + s * (z1 - z0) * 0.6 + (z1 - z0) * 0.4 }
  })

  const outline: FlatPath[] = []
  if (board.outline.length > 0) {
    for (const path of board.outline) {
      if (path.points.length < 2) continue
      const f = flat(path.points, map)
      if (path.closed) f.push(f[0] as number, f[1] as number)
      outline.push(f)
    }
  }
  if (outline.length === 0) {
    const { min, max } = board.bbox
    outline.push(flat([min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }, min], map))
  }

  const [s0, s1] = beats.silk
  const silkRaw: Array<{ path: FlatPath; y: number }> = []
  for (const [layerId, silk] of Object.entries(board.silkscreen)) {
    if (sideAt(layerId) !== 'F') continue
    for (const line of silk.lines) {
      if (line.points.length < 2) continue
      const f = flat(line.points, map)
      silkRaw.push({ path: f, y: meanY(f) })
    }
    for (const arc of silk.arcs) {
      const f = flat(arcPoints(arc), map)
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
    if (sideAt(layerId) !== 'F') continue
    for (const text of silk.texts) {
      if (text.mirrored !== back) continue
      const value = text.value.trim()
      if (value.length < 1 || value.length > 24) continue
      const m = map(text.pos)
      textRaw.push({
        y: m.y,
        text: {
          text: value,
          x: m.x,
          y: m.y,
          size: Math.max(9, text.height * fit.scale),
          // keep text upright: rot is mod π so a flipped board never draws it upside-down
          rot: upright((back ? -text.rot : text.rot) * DEG + (fit.rotated ? Math.PI / 2 : 0)),
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
    const m = map(d.pos)
    return { x: m.x, y: m.y, r: Math.max(0.8, (d.dia / 2) * fit.scale) }
  })

  const origin = hero !== undefined ? map(hero.center) : { x: resolved.width / 2, y: resolved.height / 2 }
  const warnings: TimelineWarning[] = []
  if (segs.length === 0) warnings.push({ code: 'trace-no-copper', message: 'board has no copper segments to grow' })
  if (hero === undefined) warnings.push({ code: 'trace-no-hero', message: 'no hero footprint; growth ordered from board center' })

  // --- parts: bodies on the visible face; the hero lands first, the rest are placed in act IV
  const heroPx = origin
  const rotOf = (deg: number): number => (back ? -deg : deg) * DEG + (fit.rotated ? Math.PI / 2 : 0)
  const partsMm = extractParts(board).filter((pt) => pt.back === back)
  const heroPart = partsMm.find((pt) => pt.ref === hero?.ref)
  const dists = partsMm.map((pt) => Math.hypot(pt.pos.x - originMm.x, pt.pos.y - originMm.y))
  const order = partsMm.map((_, i) => i).sort((a, b) => (dists[a] as number) - (dists[b] as number))
  const rankOf = new Map(order.map((idx, r) => [idx, r / Math.max(1, order.length - 1)]))
  const parts: TracePart[] = partsMm.map((pt, i) => {
    const m = map(pt.pos)
    const isHero = pt === heroPart
    const label = pt.kind === 'ic' && pt.value !== undefined ? pt.value.replace(/_/g, '-').toUpperCase().slice(0, 22) : undefined
    return {
      x: m.x, y: m.y, w: pt.w * fit.scale, h: pt.h * fit.scale, rot: rotOf(pt.rot), z: pt.z * fit.scale,
      kind: pt.kind,
      t: isHero ? acts.land[1] : acts.place[0] + (rankOf.get(i) ?? 0) * (acts.place[1] - acts.place[0] - 0.012),
      label,
      pitch: pt.kind === 'conn' && pt.pitch > 0 ? pt.pitch * fit.scale : undefined,
      hero: isHero
    }
  })

  // --- the stack, top first: front copper, inner layers, back
  const topSide = layers.some((l) => l.side === 'F') ? 'F' : (layers[layers.length - 1]?.side ?? 'F')
  const stackOrder = [
    ...layers.filter((l) => l.side === topSide),
    ...layers.filter((l) => l.side !== topSide && l.side === 'inner'),
    ...layers.filter((l) => l.side !== topSide && l.side !== 'inner')
  ]
  const boardArea = boardLoops(board).reduce((s, loop) => s + Math.abs(area(loop)), 0)
  const netName = new Map(board.nets.map((n) => [n.id, bareName(n.name)]))
  const stackLabels = stackOrder.map((l) => {
    const zs = board.copper[l.id]?.zones ?? []
    let best: { net: string; a: number } | undefined
    const byNet = new Map<string, number>()
    for (const z of zs) {
      const a = z.fills.reduce((s, f) => s + Math.abs(area(f)), 0)
      const key = z.netId === undefined ? 'pour' : (netName.get(z.netId) ?? 'pour')
      byNet.set(key, (byNet.get(key) ?? 0) + a)
    }
    for (const [net, a] of byNet) if (best === undefined || a > best.a) best = { net, a }
    const role = best !== undefined && best.a > 0.3 * boardArea ? `${best.net} plane` : 'signal'
    return `${l.id} · ${role}`
  })
  const minWH = Math.min(resolved.width, resolved.height)
  const stack = { gap: Math.min(0.15 * minWH, (0.42 * minWH) / Math.max(1, stackOrder.length - 1)), labels: stackLabels }

  // --- callouts and the lead's wavefront
  const callouts: TraceCallout[] = []
  if (hero !== undefined) {
    const value = board.footprints.find((f) => f.ref === hero.ref)?.value
    callouts.push({ t0: acts.heroPads[0], t1: 0.105, x: heroPx.x, y: heroPx.y, text: hero.ref, sub: value })
  }
  const leadGrp = sched.lead === undefined ? undefined : sched.groups[sched.lead.group]
  const leadFar = sched.lead === undefined ? undefined : map(sched.lead.far)
  const track: Array<{ t: number; x: number; y: number }> = []
  if (sched.lead !== undefined && leadGrp !== undefined && leadFar !== undefined) {
    const gi = sched.lead.group
    for (let t = leadGrp.t; t <= leadGrp.t + leadGrp.d + 1e-9; t += leadGrp.d / 8) {
      let sx = 0
      let sy = 0
      let n = 0
      for (const l of layers) {
        l.groups.forEach((g, i) => {
          if (g !== gi) return
          const o = i * 7
          const t0 = l.segs[o + 5] as number
          const t1 = l.segs[o + 6] as number
          if (t < t0 || t > t1) return
          const f = (t - t0) / Math.max(1e-9, t1 - t0)
          sx += (l.segs[o] as number) + ((l.segs[o + 2] as number) - (l.segs[o] as number)) * f
          sy += (l.segs[o + 1] as number) + ((l.segs[o + 3] as number) - (l.segs[o + 1] as number)) * f
          n++
        })
      }
      if (n > 0) track.push({ t, x: sx / n, y: sy / n })
    }
    const members = (netGroups[gi]?.netIds ?? []).map((id) => netName.get(id) ?? '').filter((s) => s.length > 0)
    const kind = leadGrp.kind
    const text = kind === 'bus' && members.length > 1 ? `${members[0]} – ${members[members.length - 1]}` : members.join(' / ')
    const sub = kind === 'bus' ? `${members.length} lines · land together` : kind === 'diff' ? 'differential pair · in lockstep' : kind === 'clock' ? 'clock' : 'signal'
    const arrive = leadGrp.t + leadGrp.d
    callouts.push({ t0: arrive - 0.012, t1: arrive + 0.06, x: leadFar.x, y: leadFar.y, text, sub })
  }

  const loopsPx = boardLoops(board).map((loop) => flat(loop, map))
  const centre = map({ x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 })
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
      camera: cameraTrack(box, resolved, map, layers, origin),
      beats,
      groups: sched.groups,
      board: loopsPx,
      material: material(board, resolved.palette, fit.scale),
      shots: shotList(resolved, {
        hero: heroPx,
        heroSize: heroPart === undefined ? 0.08 * minWH : Math.max(heroPart.w, heroPart.h) * fit.scale,
        lead: leadGrp === undefined || leadFar === undefined ? undefined : { far: leadFar, t: leadGrp.t, d: leadGrp.d, track },
        centre,
        loops: loopsPx,
        stackHeight: stack.gap * Math.max(0, stackOrder.length - 1) + Math.max(0, ...parts.map((pt) => pt.z))
      }),
      acts,
      parts,
      callouts,
      stack
    },
    warnings
  }
}

function area(loop: Vec2[]): number {
  let s = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] as Vec2
    const b = loop[(i + 1) % loop.length] as Vec2
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

const BEAT = 1 / 24

interface Schedule {
  groups: TraceGroup[]
  /** per seg [t0, t1], undefined for segs outside any group */
  segTime: Array<[number, number] | undefined>
  /** the lead unit and its far end (mm) — where the tracking shot heads */
  lead: { group: number; far: Vec2 } | undefined
}

/**
 * Each casting unit gets one start time and duration from its role's
 * window, ordered outward from the hero. Inside a unit every net is
 * normalised to that same window, so a bus's members leave together and
 * arrive together no matter how long each runs — length-matched lines
 * land on the same frame, which is what the designer built them for.
 */
function scheduleGroups(
  kinds: NetKind[],
  segs: GraphSeg[],
  segLen: number[],
  segNet: Array<number | undefined>,
  segGroup: number[],
  start: number[],
  md: number,
  seed: number
): Schedule {
  const netMin = new Map<number, number>()
  const netMax = new Map<number, number>()
  const far = new Map<number, Vec2>()
  const gMin = new Array<number>(kinds.length).fill(Infinity)
  const gMax = new Array<number>(kinds.length).fill(-Infinity)
  const gSegs = new Array<number>(kinds.length).fill(0)
  segs.forEach((s, i) => {
    const net = segNet[i]
    const gi = segGroup[i] as number
    if (net === undefined || gi < 0) return
    const a = start[i] as number
    const b = a + (segLen[i] as number)
    netMin.set(net, Math.min(netMin.get(net) ?? Infinity, a))
    if (b > (netMax.get(net) ?? -Infinity)) {
      netMax.set(net, b)
      far.set(net, { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 })
    }
    gMin[gi] = Math.min(gMin[gi] as number, a)
    gMax[gi] = Math.max(gMax[gi] as number, b)
    gSegs[gi] = (gSegs[gi] as number) + 1
  })

  const rng = makeRng(seed, 'trace-pulses')
  const groups: TraceGroup[] = kinds.map((kind) => ({ kind, t: ROLE_TIME[kind].start[0], d: ROLE_TIME[kind].d[0], pulses: [], pulseSpeed: 1 }))
  const snap = (t: number, q: number): number => Math.round(t / q) * q
  for (const kind of Object.keys(ROLE_TIME) as NetKind[]) {
    const mine = kinds.map((k, i) => i).filter((i) => kinds[i] === kind && (gSegs[i] as number) > 0)
      .sort((a, b) => (gMin[a] as number) - (gMin[b] as number))
    const { start: [s0, s1], d: [d0, d1] } = ROLE_TIME[kind]
    mine.forEach((gi, r) => {
      const u = 0.6 * (mine.length > 1 ? r / (mine.length - 1) : 0) + 0.4 * Math.min(1, (gMin[gi] as number) / md)
      const span = (gMax[gi] as number) - (gMin[gi] as number)
      const d = d0 + (d1 - d0) * Math.min(1, span / (0.6 * md))
      // the cast parts start on the half-beat; background nets don't
      let t = s0 + u * (s1 - s0)
      if (kind !== 'signal') t = snap(t, BEAT / 2)
      t = Math.min(t, TRACE_ACTS.signal[1] - d)
      const grp = groups[gi] as TraceGroup
      grp.t = t
      grp.d = d
      const done = t + d
      // the hero act is still: pulses stop as the mask begins to pour
      const last = TRACE_ACTS.mask[0] - BEAT / 2
      if (kind === 'clock') {
        grp.pulseSpeed = 1.8
        for (let p = snap(done + BEAT, BEAT); p < last; p += BEAT * 2) grp.pulses.push(p)
      } else if (kind === 'bus') {
        // every bus fires on the same bar lines: the board breathes in time
        grp.pulseSpeed = 1.4
        for (const p of [9, 11, 14.5].map((b) => b * BEAT)) if (p > done + BEAT / 2) grp.pulses.push(p)
      } else if (kind === 'diff') {
        grp.pulseSpeed = 1.5
        for (let p = snap(done + BEAT, BEAT); p < last; p += BEAT * 4) grp.pulses.push(p)
      } else if (kind === 'signal' && rng.next() < 0.18 && done + BEAT < last) {
        grp.pulseSpeed = 1.2
        grp.pulses.push(snap(rng.range(done + BEAT, last), BEAT / 2))
      }
    })
  }

  const segTime = segs.map((_, i): [number, number] | undefined => {
    const net = segNet[i]
    const grp = groups[segGroup[i] as number]
    if (net === undefined || grp === undefined) return undefined
    const lo = netMin.get(net) as number
    const span = Math.max(1e-6, (netMax.get(net) as number) - lo)
    const a = ((start[i] as number) - lo) / span
    const b = ((start[i] as number) + (segLen[i] as number) - lo) / span
    return [grp.t + a * grp.d, grp.t + Math.min(1, b) * grp.d]
  })

  // the lead: the first bus (else pair, else clock, else the longest net) to
  // leave the hero — the tracking shot rides it and the camera waits for it
  // where it lands
  let lead: Schedule['lead']
  const byStart = (kind: NetKind): number | undefined => kinds.map((k, i) => i).filter((i) => kinds[i] === kind && (gSegs[i] as number) > 0)
    .sort((a, b) => (groups[a] as TraceGroup).t - (groups[b] as TraceGroup).t)[0]
  const longest = kinds.map((k, i) => i).filter((i) => (gSegs[i] as number) > 0)
    .sort((a, b) => ((gMax[b] as number) - (gMin[b] as number)) - ((gMax[a] as number) - (gMin[a] as number)))[0]
  for (const first of [byStart('bus'), byStart('diff'), byStart('clock'), longest]) {
    if (first === undefined) continue
    const ends = [...far.entries()].filter(([net]) => segNet.some((n, i) => n === net && segGroup[i] === first)).map(([, p]) => p)
    if (ends.length === 0) continue
    lead = { group: first, far: { x: ends.reduce((s, p) => s + p.x, 0) / ends.length, y: ends.reduce((s, p) => s + p.y, 0) / ends.length } }
    break
  }
  return { groups, segTime, lead }
}

/**
 * Edge.Cuts arrives as loose lines and arcs; chain them end to end into
 * closed loops so the board's area can be filled (evenodd keeps cutouts).
 */
function boardLoops(board: BoardModel): Vec2[][] {
  const loops: Vec2[][] = []
  const open: Vec2[][] = []
  for (const path of board.outline) {
    if (path.points.length < 2) continue
    if (path.closed) loops.push([...path.points])
    else open.push([...path.points])
  }
  const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 0.02
  while (open.length > 0) {
    const chain = open.pop() as Vec2[]
    for (let grew = true; grew;) {
      grew = false
      for (let i = 0; i < open.length; i++) {
        const piece = open[i] as Vec2[]
        const head = chain[0] as Vec2
        const tail = chain[chain.length - 1] as Vec2
        const p0 = piece[0] as Vec2
        const p1 = piece[piece.length - 1] as Vec2
        if (near(tail, p0)) chain.push(...piece.slice(1))
        else if (near(tail, p1)) chain.push(...[...piece].reverse().slice(1))
        else if (near(head, p1)) chain.unshift(...piece.slice(0, -1))
        else if (near(head, p0)) chain.unshift(...[...piece].reverse().slice(0, -1))
        else continue
        open.splice(i, 1)
        grew = true
        break
      }
    }
    if (chain.length >= 3 && near(chain[0] as Vec2, chain[chain.length - 1] as Vec2)) loops.push(chain)
  }
  if (loops.length > 0) return loops
  const { min, max } = board.bbox
  return [[min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }]]
}

/** the board's own mask and finish under the copper palette; the stylised palettes tint them */
function material(board: BoardModel, palette: Palette, pxPerMm: number): TraceMaterial {
  const trueColour = palette.copper === '#d08a4c'
  const mask = board.stackup.maskColor?.toLowerCase()
  const finishKey = board.stackup.finish?.toLowerCase() ?? ''
  const finish = Object.entries(FINISH).find(([k]) => finishKey.startsWith(k))?.[1]
  const maskHex: string = trueColour
    ? (mask === undefined ? '#0c0d0e' : (mask.startsWith('#') ? mask : (MASK_ALBEDO[mask] ?? '#0d3b22')))
    : mixHex(palette.bg, palette.copperDim, 0.45)
  // white boards print black legends; everything else prints white
  const silk = luma(maskHex) > 0.5 ? '#1b1c1e' : '#eeeee8'
  return {
    mask: maskHex,
    finish: trueColour ? (finish?.albedo ?? '#e8a878') : palette.copper,
    finishRough: finish?.rough ?? 0.24,
    substrate: trueColour ? '#2b2617' : mixHex(palette.bg, palette.copperDim, 0.3),
    silk,
    energyWarm: trueColour ? '#ffc98a' : palette.head,
    energyCool: trueColour ? '#9fd6ff' : mixHex(palette.head, palette.silk, 0.5),
    pxPerMm,
    thicknessPx: board.stackup.thickness * pxPerMm
  }
}

function luma(hex: string): number {
  const c = (i: number): number => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
  return 0.2126 * c(0) + 0.7152 * c(1) + 0.0722 * c(2)
}

interface ShotInput {
  hero: Vec2
  /** hero body's long side, px */
  heroSize: number
  lead: { far: Vec2; t: number; d: number; track: Array<{ t: number; x: number; y: number }> } | undefined
  centre: Vec2
  loops: FlatPath[]
  /** tallest the scene gets: the exploded stack plus parts, px */
  stackHeight: number
}

/**
 * The shot list: seven shots, cut on the beat.
 *  1 macro — the hero chip lands on its glowing pads, shallow focus, slow push
 *  2 track — ride the lead unit's wavefront as it leaves the hero
 *  3 land  — cut to where it lands and wait for it: the signature beat
 *  4 wide  — the whole board fills in, a slow orbit
 *  5 crane — up and around for the stack, framed to fit it, through the slam
 *  6 hero  — cut on the impact to a held three-quarter: mask, cure, silk, parts
 *  7 beauty — a slow arc and push into the final poster
 * Every framing is solved against the board's real extent, so long boards
 * and tall frames fill the shot instead of floating in it.
 */
function shotList(resolved: ResolvedConfig, si: ShotInput): CameraShot[] {
  const D = Math.PI / 180
  const W = resolved.width
  const H = resolved.height
  const a = TRACE_ACTS
  const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const loop of si.loops) {
    for (let i = 0; i + 1 < loop.length; i += 2) {
      x0 = Math.min(x0, loop[i] as number)
      x1 = Math.max(x1, loop[i] as number)
      y0 = Math.min(y0, loop[i + 1] as number)
      y1 = Math.max(y1, loop[i + 1] as number)
    }
  }
  const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  const corners = (z: number): Array<[number, number, number]> => [[x0, y0, z], [x1, y0, z], [x0, y1, z], [x1, y1, z]]
  const flatPts = corners(0)
  const stackPts = [...corners(0), ...corners(si.stackHeight)]
  // a board much longer than the frame lies on the diagonal for its hero shot
  const bAspect = (x1 - x0) / Math.max(1, y1 - y0)
  const fAspect = W / H
  const skew = Math.abs(Math.log(bAspect / fAspect))
  const heroYaw = (skew > 0.9 ? 30 : 16) * D * (bAspect > fAspect ? 1 : -1)
  const fit = (shot: Omit<CameraShot, 't' | 'zoom' | 'cut'>, pts: Array<[number, number, number]>, m = 1): number =>
    fitZoom(shot, pts, W, H, 0.84 * m, 0.8 * m)

  // 1 macro: the hero body fills about a third of the frame height
  const macroZoom = Math.min(7, Math.max(2.2, (0.26 * H) / Math.max(1, si.heroSize)))
  const shots: CameraShot[] = [
    { t: 0, ...si.hero, zoom: macroZoom, tilt: 58 * D, yaw: -24 * D, aperture: 0.85 },
    { t: 0.1, ...si.hero, zoom: macroZoom * 1.14, tilt: 55 * D, yaw: -15 * D, aperture: 0.8 }
  ]
  const lead = si.lead
  const arrive = lead === undefined ? 0.26 : Math.min(0.42, Math.max(0.2, lead.t + lead.d))
  // 2 track: lead the action by a fifth, low and close
  const trackTilt = 50 * D
  const trackZoom = Math.min(3.4, Math.max(1.8, macroZoom * 0.6))
  const t2 = 0.1
  const t3 = arrive - 0.045
  if (lead !== undefined && lead.track.length >= 2) {
    const keys = lead.track.filter((k) => k.t >= t2 && k.t <= t3)
    const head = (t: number): Vec2 => {
      const tr = lead.track
      let k = 0
      while (k + 1 < tr.length && (tr[k + 1] as { t: number }).t <= t) k++
      const p = tr[k] as { t: number; x: number; y: number }
      const q = tr[Math.min(k + 1, tr.length - 1)] as { t: number; x: number; y: number }
      const u = q.t > p.t ? Math.min(1, Math.max(0, (t - p.t) / (q.t - p.t))) : 0
      return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u }
    }
    const ahead = (t: number): Vec2 => lerp(head(t), lead.far, 0.2)
    shots.push({ t: t2 + 0.001, ...ahead(t2), zoom: trackZoom, tilt: trackTilt, yaw: -10 * D, aperture: 0.32, cut: true })
    for (const k of keys.filter((_, i) => i % 2 === 1)) shots.push({ t: k.t, ...ahead(k.t), zoom: trackZoom, tilt: trackTilt, yaw: -10 * D + 16 * D * ((k.t - t2) / (t3 - t2)), aperture: 0.32 })
    shots.push({ t: t3 - 0.001, ...ahead(t3), zoom: trackZoom * 0.94, tilt: trackTilt, yaw: 6 * D, aperture: 0.32 })
    // 3 land: wait at the destination, push in a touch as it arrives
    const far = lead.far
    shots.push({ t: t3, ...far, zoom: trackZoom * 1.15, tilt: 40 * D, yaw: 22 * D, aperture: 0.55, cut: true })
    shots.push({ t: arrive + 0.05, ...far, zoom: trackZoom * 1.28, tilt: 38 * D, yaw: 25 * D, aperture: 0.55 })
  } else {
    shots.push({ t: t2 + 0.001, ...lerp(si.hero, si.centre, 0.4), zoom: trackZoom, tilt: trackTilt, yaw: -6 * D, aperture: 0.32, cut: true })
    shots.push({ t: arrive + 0.05, ...lerp(si.hero, si.centre, 0.7), zoom: trackZoom * 0.85, tilt: 44 * D, yaw: 12 * D, aperture: 0.4 })
  }
  // 4 wide: the whole board fills in under a slow orbit
  const t4 = arrive + 0.051
  const wide0 = { ...mid, tilt: 34 * D, yaw: 6 * D, aperture: 0.16 }
  const wide1 = { ...mid, tilt: 30 * D, yaw: 16 * D, aperture: 0.1 }
  shots.push({ t: t4, ...wide0, zoom: fit(wide0, flatPts) * 1.18, cut: true })
  shots.push({ t: a.signal[1], ...wide1, zoom: fit(wide1, flatPts) * 1.04 })
  // 5 crane: framed to hold the whole exploded stack, orbiting through the slam
  const crane0 = { ...mid, tilt: 54 * D, yaw: 30 * D, aperture: 0.06 }
  const crane1 = { ...mid, tilt: 57 * D, yaw: 40 * D, aperture: 0.06 }
  shots.push({ t: a.explode[1], ...crane0, zoom: fit(crane0, stackPts, 1.08) })
  shots.push({ t: a.slam[1], ...crane1, zoom: fit(crane1, stackPts, 1.08) * 1.04 })
  // 6 hero: cut on the impact to a held three-quarter
  const hero0 = { ...mid, tilt: 36 * D, yaw: heroYaw, aperture: 0.05 }
  const hz = fit(hero0, flatPts, 1.06)
  shots.push({ t: a.slam[1] + 0.004, ...hero0, zoom: hz, cut: true })
  shots.push({ t: a.place[1], ...hero0, zoom: hz * 1.03 })
  // 7 beauty: a slow arc and push into the poster
  const beauty = { ...mid, tilt: 30 * D, yaw: heroYaw * 0.55, aperture: 0.04 }
  shots.push({ t: 1, ...beauty, zoom: fit(beauty, flatPts, 1.0) * 1.03 })
  return shots
}

function mixHex(a: string, b: string, t: number): string {
  const c = (h: string, i: number): number => Number.parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `#${[0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Boards that fill the frame get a gentle whole-film push. Boards that leave
 * it mostly empty (a 1:3 board in 4:5, a square board in 9:16) punch in on the
 * hero, ride the growth front at a zoom that fills the frame, then pull back
 * to the whole board for the hold — the reveal.
 */
function cameraTrack(
  bbox: BBox,
  resolved: ResolvedConfig,
  map: (p: Vec2) => Vec2,
  layers: TraceLayer[],
  origin: { x: number; y: number }
): CameraKey[] {
  const W = resolved.width
  const H = resolved.height
  const corners = [bbox.min, { x: bbox.max.x, y: bbox.min.y }, bbox.max, { x: bbox.min.x, y: bbox.max.y }].map(map)
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
  const [g0, g1] = TRACE_BEATS.growth
  const STEP = 0.04
  const fronts: Array<{ t: number; x: number; y: number }> = []
  let last = { x: origin.x, y: origin.y }
  for (let t = g0; t < g1 - 1e-9; t += STEP) {
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
    const w = fronts.slice(Math.max(0, i - 2), i + 3)
    return { t: f.t, x: w.reduce((a, b) => a + b.x, 0) / w.length, y: w.reduce((a, b) => a + b.y, 0) / w.length }
  })
  return [
    { t: 0, ...home, zoom: 1 },
    { t: TRACE_BEATS.outline[0] + 0.07, ...home, zoom: 1 },
    { t: TRACE_BEATS.pads[0] + 0.07, ...clampKey(origin.x, origin.y), zoom },
    ...smooth.filter((f) => f.t > TRACE_BEATS.pads[0] + 0.07 && f.t < g1 - 0.02).map((f) => ({ t: f.t, ...clampKey(f.x, f.y), zoom })),
    { t: g1, ...clampKey(last.x, last.y), zoom },
    // the reveal lands before zones/silk finish so the whole board holds ≥1.5s
    { t: 0.8, ...home, zoom: 1 },
    { t: 1, ...home, zoom: 1.03 }
  ]
}

function meanY(path: FlatPath): number {
  let sum = 0
  for (let i = 1; i < path.length; i += 2) sum += path[i] as number
  return sum / Math.max(1, path.length / 2)
}
