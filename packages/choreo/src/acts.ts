import type { BoardModel, Footprint, Vec2 } from '@silk-reel/ingest'
import type { CellKind } from './cells'
import { classify, CLASS_CELL } from './cells'
import type { FormationId } from './types'

/**
 * Three acts, each a structure with a direction of growth. Cells sit on an
 * integer lattice (1 = one pitch); only the fundamental copy is authored and
 * the symmetry expands it. Seeds are where each act's first marks land; the
 * previous act strips back toward them, so every act hands off like a match
 * cut instead of a fade.
 */
export type Sym = 'single' | 'rot2' | 'mirrorX' | 'quad'
export type Role = 'anchor' | 'body' | 'edge' | 'joint' | 'accent' | 'hero' | 'text'

export interface Cell {
  x: number
  y: number
  role: Role
  sym: Sym
  /** forced shape; otherwise the composer picks from the board's census */
  kind?: CellKind | undefined
  /** forced glyph id (hero silhouette, text token) */
  glyphId?: string | undefined
  /** size in pitches; role default when omitted */
  size?: number | undefined
  rot?: number | undefined
  flipX?: boolean | undefined
  flipY?: boolean | undefined
  /** growth weight: >1 makes this cell arrive later than its distance says */
  lag?: number | undefined
}

export interface ActPlan {
  id: FormationId
  cells: Cell[]
  /** every symmetric seed position, lattice units */
  seeds: Vec2[]
}

/** lattice half-extents (cells) the frame can hold */
export interface Room {
  nx: number
  ny: number
}

const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)))

class Grid {
  readonly cells: Cell[] = []
  private readonly taken = new Set<string>()
  constructor(private readonly sym: Sym) {}
  private keys(x: number, y: number, sym = this.sym): string[] {
    const k = (a: number, b: number): string => `${Math.round(a * 2)},${Math.round(b * 2)}`
    switch (sym) {
      case 'single':
        return [k(x, y)]
      case 'rot2':
        return [k(x, y), k(-x, -y)]
      case 'mirrorX':
        return [k(x, y), k(-x, y)]
      case 'quad':
        return [k(x, y), k(-x, y), k(x, -y), k(-x, -y)]
    }
  }
  add(c: Omit<Cell, 'sym'> & { sym?: Sym }): boolean {
    const keys = this.keys(c.x, c.y, c.sym)
    if (keys.some((key) => this.taken.has(key))) return false
    for (const key of keys) this.taken.add(key)
    this.cells.push({ ...c, sym: c.sym ?? this.sym })
    return true
  }
  has(x: number, y: number): boolean {
    return this.keys(x, y).some((key) => this.taken.has(key))
  }
}

const key = (p: Vec2): string => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`

/** a footprint's pad count, by ref */
function padCounts(board: BoardModel): Map<string, number> {
  const pads = new Map<string, number>()
  for (const layer of Object.values(board.copper)) {
    for (const p of layer.pads) if (p.footprintRef !== undefined) pads.set(p.footprintRef, (pads.get(p.footprintRef) ?? 0) + 1)
  }
  return pads
}

/** the body cell a real footprint stands for */
function partKind(f: Footprint, pads: Map<string, number>): CellKind {
  const cls = classify(f.ref, f.value)
  // only real headers read as brackets; small connectors are pads
  return cls === 'conn' && (pads.get(f.ref) ?? 0) < 6 ? 'pad' : CLASS_CELL[cls]
}

/** Douglas–Peucker: indices of the vertices that stray more than `eps` from the chord */
function simplify(pts: Vec2[], eps: number): number[] {
  const keep = new Set([0, pts.length - 1])
  const split = (i: number, j: number): void => {
    const a = pts[i] as Vec2
    const b = pts[j] as Vec2
    const len = Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y))
    let far = -1
    let worst = eps
    for (let m = i + 1; m < j; m++) {
      const p = pts[m] as Vec2
      const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len
      if (d > worst) [far, worst] = [m, d]
    }
    if (far < 0) return
    keep.add(far)
    split(i, far)
    split(far, j)
  }
  split(0, pts.length - 1)
  return [...keep].sort((a, b) => a - b)
}

/**
 * The hero's own copper, walked: per net, segments chain through shared
 * endpoints (vias and through-holes join layers at one point), and the route
 * runs from the hero's pad to the point farthest from the chip. The longest
 * routes in distinct directions win; the C2 twin would cover a route's
 * opposite, so direction is compared modulo a half turn.
 */
function heroRoutes(board: BoardModel, hero: Footprint, max: number): Vec2[][] {
  const layers = Object.values(board.copper)
  const heroPads = layers.flatMap((l) => l.pads).filter((p) => p.footprintRef === hero.ref && p.netId !== undefined)
  const found: Array<{ pts: Vec2[]; reach: number; angle: number }> = []
  for (const net of new Set(heroPads.map((p) => p.netId))) {
    const pos = new Map<string, Vec2>()
    const adj = new Map<string, Array<[string, number]>>()
    for (const l of layers) {
      for (const t of l.traces) {
        if (t.netId !== net) continue
        for (let i = 1; i < t.points.length; i++) {
          const a = t.points[i - 1] as Vec2
          const b = t.points[i] as Vec2
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          for (const [p, q] of [[a, b], [b, a]] as const) {
            pos.set(key(p), p)
            const out = adj.get(key(p)) ?? []
            out.push([key(q), d])
            adj.set(key(p), out)
          }
        }
      }
    }
    const mine = heroPads.filter((h) => h.netId === net)
    const dist = new Map<string, number>()
    const prev = new Map<string, string>()
    for (const [k, p] of pos) {
      if (mine.some((h) => Math.hypot(p.x - h.pos.x, p.y - h.pos.y) <= Math.max(h.size.x, h.size.y) / 2 + 0.1)) dist.set(k, 0)
    }
    const done = new Set<string>()
    for (;;) {
      let u: string | undefined
      for (const [k, d] of dist) if (!done.has(k) && (u === undefined || d < (dist.get(u) as number))) u = k
      if (u === undefined) break
      done.add(u)
      for (const [v, w] of adj.get(u) ?? []) {
        const d = (dist.get(u) as number) + w
        if (d < (dist.get(v) ?? Infinity)) {
          dist.set(v, d)
          prev.set(v, u)
        }
      }
    }
    let far: string | undefined
    let reach = 0
    for (const k of done) {
      const p = pos.get(k) as Vec2
      const r = Math.hypot(p.x - hero.pos.x, p.y - hero.pos.y)
      if (r > reach) [far, reach] = [k, r]
    }
    if (far === undefined) continue
    const pts: Vec2[] = []
    for (let k: string | undefined = far; k !== undefined; k = prev.get(k)) pts.unshift(pos.get(k) as Vec2)
    const end = pts[pts.length - 1] as Vec2
    found.push({ pts, reach, angle: Math.atan2(end.y - hero.pos.y, end.x - hero.pos.x) })
  }
  found.sort((a, b) => b.reach - a.reach)
  const picked: typeof found = []
  for (const r of found) {
    const apart = (a: number): number => {
      const d = Math.abs(a - r.angle) % Math.PI
      return Math.min(d, Math.PI - d)
    }
    if (picked.every((p) => apart(p.angle) > 0.4)) picked.push(r)
    if (picked.length === max) break
  }
  return picked.map((r) => r.pts)
}

/** the copper's own direction as a mark: dash, tick, or a short slash for 45° runs */
function stroke(dx: number, dy: number): Pick<Cell, 'kind' | 'size' | 'flipX'> {
  const a = Math.abs(Math.atan2(dy, dx)) % Math.PI
  const t = Math.min(a, Math.PI - a)
  if (t < Math.PI / 8) return { kind: 'dash', size: 1.3 }
  if (t > (Math.PI * 3) / 8) return { kind: 'tick', size: 1 }
  return { kind: 'slash', size: 0.62, flipX: dx * dy > 0 }
}

/**
 * Act I — the routes. The hero chip sits at the centre and its longest real
 * traces run out to the parts they feed, stepped onto the lattice with a C2
 * twin and drawn as strokes along the copper's direction. Bends and vias
 * become joints; each route ends on the cell of the part it reaches. Growth
 * runs from the chip outward, along the copper. A board without routed
 * copper falls back to straight lines to its farthest parts.
 */
export function routeAct(board: BoardModel, room: Room, hero: Footprint | undefined, heroGlyph: string | undefined): ActPlan {
  const g = new Grid('rot2')
  g.add(heroGlyph === undefined ? { x: 0, y: 0, role: 'anchor', sym: 'single' } : { x: 0, y: 0, role: 'hero', glyphId: heroGlyph, size: 1.5, sym: 'single' })
  if (hero === undefined) return { id: 'route', cells: g.cells, seeds: [{ x: 0, y: 0 }] }
  const real = board.footprints.filter((f) => !/\*/.test(f.ref) && f !== hero)
  let routes = heroRoutes(board, hero, 5)
  if (routes.length === 0) {
    routes = [...real]
      .sort((a, b) => Math.hypot(b.pos.x - hero.pos.x, b.pos.y - hero.pos.y) - Math.hypot(a.pos.x - hero.pos.x, a.pos.y - hero.pos.y))
      .slice(0, 3)
      .map((f) => [hero.pos, f.pos])
  }
  const pads = padCounts(board)
  const vias = new Set(Object.values(board.copper).flatMap((l) => l.vias.map((v) => key(v.pos))))
  const allPads = Object.values(board.copper).flatMap((l) => l.pads)
  const rel = routes.map((r) => r.map((p) => ({ x: p.x - hero.pos.x, y: p.y - hero.pos.y })))
  const ex = Math.max(1e-6, ...rel.flat().map((p) => Math.abs(p.x)))
  const ey = Math.max(1e-6, ...rel.flat().map((p) => Math.abs(p.y)))
  const turn = ex > ey !== room.nx > room.ny
  // fit the median route, not the longest: one long run would shrink the rest
  // into the chip; longer routes run off the frame edge instead
  const fits = rel
    .map((r) => {
      const rx = Math.max(1e-6, ...r.map((p) => Math.abs(turn ? p.y : p.x)))
      const ry = Math.max(1e-6, ...r.map((p) => Math.abs(turn ? p.x : p.y)))
      return Math.min((room.nx - 2) / rx, (room.ny - 2) / ry)
    })
    .sort((a, b) => a - b)
  const k = fits[Math.floor((fits.length - 1) / 2)] as number
  const toLattice = (p: Vec2): Vec2 => (turn ? { x: -p.y * k, y: p.x * k } : { x: p.x * k, y: p.y * k })
  for (const [ri, route] of routes.entries()) {
    // the lattice cannot hold sub-cell jogs: keep only the bends it can show
    const kept = simplify((rel[ri] as Vec2[]).map(toLattice), 0.6)
    const pts = kept.map((i) => toLattice(rel[ri]?.[i] as Vec2))
    const tip = route[route.length - 1] as Vec2
    // the part this route reaches names its last cell
    const near = allPads.find((p) => p.footprintRef !== hero.ref && Math.hypot(p.pos.x - tip.x, p.pos.y - tip.y) < Math.max(p.size.x, p.size.y))
    const part = near === undefined ? undefined : real.find((f) => f.ref === near.footprintRef)
    let last = '0,0'
    walk: for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as Vec2
      const b = pts[i] as Vec2
      // Chebyshev steps: a 45° run lands on clean diagonal cells
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))))
      for (let s = 1; s <= steps; s++) {
        const x = Math.round(a.x + ((b.x - a.x) * s) / steps)
        const y = Math.round(a.y + ((b.y - a.y) * s) / steps)
        if (Math.abs(x) > room.nx - 1 || Math.abs(y) > room.ny - 1) break walk
        if (`${x},${y}` === last || Math.hypot(x, y) < 1.5) continue
        last = `${x},${y}`
        const tipCell = i === pts.length - 1 && s === steps
        const corner = s === steps && !tipCell
        if (tipCell) g.add({ x, y, role: 'anchor', kind: part === undefined ? 'pad' : partKind(part, pads) })
        else if (corner) g.add({ x, y, role: 'joint', kind: vias.has(key(route[kept[i] as number] as Vec2)) ? 'ring' : undefined })
        else g.add({ x, y, role: 'body', ...stroke(b.x - a.x, b.y - a.y) })
      }
    }
  }
  return { id: 'route', cells: g.cells, seeds: [{ x: 0, y: 0 }] }
}

/**
 * Act II — the plan. The whole board from above, folded about its centre:
 * the outline as dashes and ticks, mounting holes as rings, every part on its
 * real site. A board whose long side disagrees with the frame turns a quarter
 * turn. It grows from where the hero sits on the board.
 */
export function planAct(board: BoardModel, room: Room, hero: Footprint | undefined): ActPlan {
  const g = new Grid('quad')
  const c = { x: (board.bbox.min.x + board.bbox.max.x) / 2, y: (board.bbox.min.y + board.bbox.max.y) / 2 }
  const bw = board.bbox.max.x - board.bbox.min.x
  const bh = board.bbox.max.y - board.bbox.min.y
  const turn = bw > bh !== room.nx > room.ny
  const hw = Math.max(1e-6, (turn ? bh : bw) / 2)
  const hh = Math.max(1e-6, (turn ? bw : bh) / 2)
  const k = Math.min((room.nx - 1) / hw, (room.ny - 1) / hh)
  const fold = (p: Vec2): Vec2 => {
    const dx = Math.abs(p.x - c.x) * k
    const dy = Math.abs(p.y - c.y) * k
    return turn ? { x: dy, y: dx } : { x: dx, y: dy }
  }
  for (const d of board.drill) {
    // mounting holes, not tooling or connector pegs
    if (d.plated || d.dia < 2) continue
    const p = fold(d.pos)
    g.add({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2, role: 'joint', kind: 'ring' })
  }
  for (const path of board.outline) {
    // fold each sample, not the ends: an edge across the axis folds onto itself
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1] as Vec2
      const b = path.points[i] as Vec2
      const flat = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) !== turn
      const steps = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) * k) / 2))
      for (let s = 0; s < steps; s++) {
        const p = fold({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps })
        g.add({ x: Math.round(p.x), y: Math.round(p.y), role: 'edge', kind: flat ? 'dash' : 'tick' })
      }
    }
  }
  for (const cell of foldParts(board, board.footprints.filter((f) => !/\*/.test(f.ref)), fold, room.nx - 2, room.ny - 2, 0.22)) {
    g.add({ x: cell.x, y: cell.y, role: cell.big ? 'anchor' : 'body', kind: cell.kind, size: cell.big ? 1.5 : 0.7 })
  }
  const h = fold(hero?.pos ?? c)
  const hx = Math.round(h.x)
  const hy = Math.round(h.y)
  return { id: 'plan', cells: g.cells, seeds: [{ x: hx, y: hy }, { x: -hx, y: hy }, { x: hx, y: -hy }, { x: -hx, y: -hy }] }
}

export interface CoreCell {
  x: number
  y: number
  kind: CellKind
  big: boolean
}

/**
 * Act III — the frame. Corner cuts mark an octagon, the frame closes, then the
 * board itself fills the inside: the real neighbourhood of the hero chip,
 * folded into one quadrant and mirrored. The hero lands last, alone, at the
 * centre — the beat the whole loop has been walking toward.
 */
export function frameAct(
  room: Room,
  core: CoreCell[],
  heroGlyph: string | undefined,
  labels: string[]
): ActPlan {
  const g = new Grid('quad')
  const Fx = clampI(room.nx - 1, 4, 7)
  const Fy = clampI(Math.min(room.ny - 2, Fx + 2), 4, 9)
  const cut = { x: Fx - 0.5, y: Fy - 0.5 }
  g.add({ x: cut.x, y: cut.y, role: 'accent', kind: 'slash', size: 1, flipX: true })
  g.add({ x: Fx + 0.55, y: Fy + 0.55, role: 'accent', kind: 'wedge', flipX: true, flipY: true })
  g.add({ x: Fx - 1.6, y: Fy - 1.6, role: 'anchor', kind: 'leaf', flipY: true })
  for (let x = Fx - 3; x >= 0.5; x -= 2) g.add({ x, y: Fy, role: 'edge', kind: 'dash' })
  for (let y = Fy - 3; y >= 0.5; y -= 2) g.add({ x: Fx, y, role: 'edge', kind: 'tick' })
  // the board's own words ride outside the frame, top and bottom
  const [top, bottom] = labels
  if (top !== undefined) g.add({ x: Fx - 2.4, y: -(Fy + 1.1), role: 'text', glyphId: top, sym: 'mirrorX', lag: 1.2 })
  const low = bottom ?? top
  if (low !== undefined) g.add({ x: Fx - 2.4, y: Fy + 1.1, role: 'text', glyphId: low, sym: 'mirrorX', lag: 1.2 })
  // the hero owns the middle 3×3
  const hero = heroGlyph !== undefined
  for (const c of core) {
    if (c.x > Fx - 2 || c.y > Fy - 2) continue
    if (hero && c.x < 2 && c.y < 2) continue
    g.add({ x: c.x, y: c.y, role: c.big ? 'anchor' : 'body', kind: c.kind, size: c.big ? 1.7 : 0.78 })
  }
  if (hero) g.add({ x: 0, y: 0, role: 'hero', glyphId: heroGlyph, size: 2.9, sym: 'single', lag: 1.15 })
  return {
    id: 'frame',
    cells: g.cells,
    seeds: [
      { x: cut.x, y: cut.y },
      { x: -cut.x, y: cut.y },
      { x: cut.x, y: -cut.y },
      { x: -cut.x, y: -cut.y }
    ]
  }
}

const PRIORITY: Record<CellKind, number> = {
  chip: 6, leaf: 5, half: 4, pad: 3, ring: 3, bracket: 2, pill: 1,
  dot: 0, tick: 0, dash: 0, slash: 0, wedge: 0, corner: 0
}

/** the board's biggest IC by pad count, else its biggest part */
export function heroPart(board: BoardModel): Footprint | undefined {
  const pads = padCounts(board)
  const real = board.footprints.filter((f) => !/\*/.test(f.ref))
  const ics = real.filter((f) => classify(f.ref, f.value) === 'ic')
  return (ics.length > 0 ? ics : real).reduce<Footprint | undefined>(
    (best, f) => (best === undefined || (pads.get(f.ref) ?? 0) > (pads.get(best.ref) ?? 0) ? f : best),
    undefined
  )
}

/**
 * Parts snapped onto one quadrant of the lattice by `fold` (mm → lattice
 * units). One cell per site; the higher-ranked part wins a collision so ICs
 * and diodes read through the passive flood. Dense at the origin, thinning
 * outward; `fill` caps the share of sites taken so the lattice breathes.
 */
function foldParts(board: BoardModel, parts: Footprint[], fold: (p: Vec2) => Vec2, cx: number, cy: number, fill: number): CoreCell[] {
  const pads = padCounts(board)
  const candidates: Array<CoreCell & { rank: number }> = []
  for (const f of parts) {
    const p = fold(f.pos)
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x > cx || y > cy) continue
    const kind = partKind(f, pads)
    const n = pads.get(f.ref) ?? 0
    const near = 1 - Math.hypot(x / (cx + 1), y / (cy + 1)) / Math.SQRT2
    candidates.push({ x, y, kind, big: classify(f.ref, f.value) === 'ic' && n >= 14, rank: PRIORITY[kind] * 50 + Math.min(n, 60) + near * 400 })
  }
  // strongest parts claim their sites first; big ICs take a 2×2 block
  candidates.sort((a, b) => b.rank - a.rank)
  const cap = Math.max(6, Math.round((cx + 1) * (cy + 1) * fill))
  const taken = new Set<string>()
  const cells: CoreCell[] = []
  for (const c of candidates) {
    if (cells.length >= cap) break
    // a block straddling an axis would overlap its own mirror copy
    const block = c.big && c.x >= 1 && c.y >= 1 && c.x + 1 <= cx && c.y + 1 <= cy
      ? [[0, 0], [1, 0], [0, 1], [1, 1]]
      : [[0, 0]]
    const keys = block.map(([dx, dy]) => `${c.x + (dx as number)},${c.y + (dy as number)}`)
    if (keys.some((k) => taken.has(k))) continue
    for (const k of keys) taken.add(k)
    cells.push(block.length > 1 ? { x: c.x + 0.5, y: c.y + 0.5, kind: c.kind, big: true } : { x: c.x, y: c.y, kind: c.kind, big: false })
  }
  return cells
}

/**
 * The hero's real neighbourhood, folded: every footprint's offset from the
 * hero chip, mirrored into one quadrant and snapped to the lattice, scaled so
 * the nearer ~70% of parts land inside the core.
 */
export function boardCore(board: BoardModel, hero: Footprint | undefined, cx: number, cy: number): CoreCell[] {
  if (hero === undefined) return []
  const others = board.footprints.filter((f) => !/\*/.test(f.ref) && f !== hero)
  if (others.length === 0) return []
  const reach = others.map((f) => Math.max(Math.abs(f.pos.x - hero.pos.x) / cx, Math.abs(f.pos.y - hero.pos.y) / cy)).sort((a, b) => a - b)
  const mmPerCell = Math.max(0.5, reach[Math.floor(reach.length * 0.7)] ?? 1)
  return foldParts(board, others, (p) => ({ x: Math.abs(p.x - hero.pos.x) / mmPerCell, y: Math.abs(p.y - hero.pos.y) / mmPerCell }), cx, cy, 0.5)
}
