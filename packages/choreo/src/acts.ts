import type { BoardModel, Vec2 } from '@silk-reel/ingest'
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

/**
 * Act I — the spine. Two arms reach in from opposite corners along a stepped
 * diagonal (C2), meet at the centre and throw out wings. Growth runs from the
 * arm tips inward, so the eye travels the diagonal and lands on the centre.
 */
export function spineAct(room: Room, lean: number): ActPlan {
  const g = new Grid('rot2')
  const L = clampI(room.ny - 2, 5, 8)
  const A = clampI(L * lean, 1, Math.max(1, room.nx - 3))
  // the tip: a leaf with its round corner facing out of the frame, a pad at its shoulder
  const tipY = -L
  g.add({ x: A, y: tipY, role: 'anchor', kind: 'leaf' })
  g.add({ x: A + 1, y: tipY + 0.8, role: 'joint', kind: 'pad' })
  g.add({ x: A - 1, y: tipY + 1, role: 'edge', kind: 'tick' })
  // the band: down the diagonal, every row carries a two-cell stride; every
  // third row breathes (one cell and a satellite) so the arm reads as nodes
  for (let y = tipY + 1; y <= -1; y++) {
    const t = (y - tipY) / L
    const x = Math.round(A * (1 - t))
    const r = y - tipY
    if (r % 3 === 0) {
      g.add({ x, y, role: 'anchor' })
      g.add({ x: x + 1.5, y, role: 'joint', kind: r % 2 === 0 ? 'ring' : 'dot' })
      continue
    }
    g.add({ x, y, role: 'body' })
    g.add({ x: x - 1, y, role: r % 3 === 1 ? 'body' : 'edge' })
    if (r % 4 === 2) g.add({ x: x + 1, y: y - 0.5, role: 'edge', kind: 'bracket', flipX: true })
  }
  // the crossing: two short rows throw out from the centre, the lower one
  // shorter, ending on a single mark
  const W = clampI(room.nx - 4, 2, 4)
  g.add({ x: 0, y: 0, role: 'anchor', sym: 'single', lag: 1.05 })
  for (let i = 1; i <= W; i++) {
    g.add({ x: i, y: 0.5, role: i === W ? 'joint' : 'body', lag: 1.15 })
  }
  g.add({ x: W + 1, y: 0.5, role: 'accent', kind: 'dot', lag: 1.35 })
  return { id: 'spine', cells: g.cells, seeds: [{ x: A, y: tipY }, { x: -A, y: -tipY }] }
}

/**
 * Act II — the pillars. Four marks at the centre open into a ring, and twin
 * columns climb out of it, top and bottom, capped by mirrored leaves (D2).
 */
export function pillarsAct(room: Room, outer: boolean): ActPlan {
  const g = new Grid('quad')
  const H = clampI(room.ny - 2.5, 3, 7)
  const c = 2
  // the core: a ring of four, a dot on each axis
  g.add({ x: 1, y: 0.5, role: 'joint', kind: 'ring' })
  g.add({ x: 0, y: 1.5, role: 'joint', kind: 'dot' })
  g.add({ x: 0, y: 0, role: 'joint', kind: 'pad', sym: 'single' })
  // each pillar is two cells wide: a long segment, one row of breath (a
  // bracket pair holds the gap open), a shorter segment, the cap
  const seg1 = Math.max(2, Math.ceil(H * 0.55))
  for (let i = 0; i < H; i++) {
    const y = 1 + i
    if (i === seg1) {
      g.add({ x: c + 0.5, y, role: 'edge', kind: 'dash' })
      continue
    }
    g.add({ x: c, y, role: i === 0 ? 'anchor' : 'body' })
    g.add({ x: c + 1, y, role: i % 3 === 2 ? 'edge' : 'body' })
    if (i % 2 === 1) g.add({ x: c - 1, y, role: 'joint', kind: 'dot' })
  }
  // caps: leaves whose round corners point away from the centre
  g.add({ x: c + 1, y: H + 1, role: 'anchor', kind: 'leaf', flipY: true })
  g.add({ x: c, y: H + 1, role: 'joint', kind: 'pad' })
  g.add({ x: c - 1, y: H + 1.6, role: 'accent', kind: 'dot' })
  if (outer && room.nx >= 6) {
    g.add({ x: c + 3, y: 1.5, role: 'body', lag: 1.25 })
    g.add({ x: c + 3, y: 2.5, role: 'body', lag: 1.25 })
    g.add({ x: c + 4, y: 2, role: 'accent', kind: 'dot', lag: 1.3 })
  }
  return {
    id: 'pillars',
    cells: g.cells,
    seeds: [{ x: 1, y: 0.5 }, { x: -1, y: 0.5 }, { x: 1, y: -0.5 }, { x: -1, y: -0.5 }]
  }
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

export interface BoardCore {
  heroRef: string | undefined
  cells: CoreCell[]
}

/**
 * The hero's real neighbourhood, folded: every footprint's offset from the
 * hero chip, mirrored into one quadrant and snapped to the lattice. One cell
 * per site; the higher-ranked part wins a collision so ICs and diodes read
 * through the passive flood.
 */
export function boardCore(board: BoardModel, cx: number, cy: number): BoardCore {
  const pads = new Map<string, number>()
  for (const layer of Object.values(board.copper)) {
    for (const p of layer.pads) if (p.footprintRef !== undefined) pads.set(p.footprintRef, (pads.get(p.footprintRef) ?? 0) + 1)
  }
  const real = board.footprints.filter((f) => !/\*/.test(f.ref))
  const ics = real.filter((f) => classify(f.ref, f.value) === 'ic')
  const pool = ics.length > 0 ? ics : real
  const hero = pool.reduce<(typeof real)[number] | undefined>(
    (best, f) => (best === undefined || (pads.get(f.ref) ?? 0) > (pads.get(best.ref) ?? 0) ? f : best),
    undefined
  )
  if (hero === undefined) return { heroRef: undefined, cells: [] }
  const offsets = real
    .filter((f) => f !== hero)
    .map((f) => ({ f, dx: Math.abs(f.pos.x - hero.pos.x), dy: Math.abs(f.pos.y - hero.pos.y) }))
  if (offsets.length === 0) return { heroRef: hero.ref, cells: [] }
  // scale so the nearer ~70% of parts land inside the core
  const reach = offsets.map((o) => Math.max(o.dx / cx, o.dy / cy)).sort((a, b) => a - b)
  const mmPerCell = Math.max(0.5, reach[Math.floor(reach.length * 0.7)] ?? 1)
  const candidates: Array<CoreCell & { rank: number }> = []
  for (const o of offsets) {
    const x = Math.round(o.dx / mmPerCell)
    const y = Math.round(o.dy / mmPerCell)
    if (x > cx || y > cy) continue
    const cls = classify(o.f.ref, o.f.value)
    const n = pads.get(o.f.ref) ?? 0
    // only real headers read as brackets; small connectors are pads
    const kind = cls === 'conn' && n < 6 ? 'pad' : CLASS_CELL[cls]
    // dense at the hero, thinning outward: the core has a gradient, not a carpet
    const near = 1 - Math.hypot(x / (cx + 1), y / (cy + 1)) / Math.SQRT2
    candidates.push({ x, y, kind, big: cls === 'ic' && n >= 14, rank: PRIORITY[kind] * 50 + Math.min(n, 60) + near * 400 })
  }
  // strongest parts claim their sites first; big ICs take a 2×2 block. The
  // core keeps about half its sites so the lattice breathes
  candidates.sort((a, b) => b.rank - a.rank)
  const cap = Math.max(6, Math.round((cx + 1) * (cy + 1) * 0.5))
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
    cells.push(block.length > 1 ? { x: c.x + 0.5, y: c.y + 0.5, kind: c.kind, big: true } : { ...c, big: false })
  }
  return { heroRef: hero.ref, cells }
}
