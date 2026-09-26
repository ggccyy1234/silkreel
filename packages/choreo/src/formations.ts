import type { Rng } from './rng'
import type { FormationId, Glyph, GlyphKind } from './types'

export type CopySpec = { mode: 'single' } | { mode: 'mirrorX' } | { mode: 'quad' }

export interface Slot {
  x: number
  y: number
  rot: number
  scale: number
  copies: CopySpec
  /** 0..1 reveal rank — the spatial script for when this slot pops in;
   *  dissolves run last-in-first-out so high-order slots leave first */
  order: number
  /** hold-drift rotation sign — orbit's inner ring counter-rotates */
  turn?: number | undefined
  /** this slot is the formation's hero — drawn in the palette's head colour */
  hero?: boolean | undefined
}

/** no cast member ever lands smaller than this — below it a glyph is noise */
const SCALE_FLOOR: Record<GlyphKind, number> = { package: 0.12, text: 0.05, mark: 0.035 }
const floorScale = (v: number, kind: GlyphKind): number => Math.max(v, SCALE_FLOOR[kind])

export interface GlyphGroups {
  packages: Glyph[]
  texts: Glyph[]
  marks: Glyph[]
}

const SINGLE: CopySpec = { mode: 'single' }
const MIRROR_X: CopySpec = { mode: 'mirrorX' }
const QUAD: CopySpec = { mode: 'quad' }
const PI2 = Math.PI / 2

/** a glyph may hold several slots in one formation — motif repetition */
export type SlotMap = Map<string, Slot[]>

function place(out: SlotMap, glyph: Glyph, s: Slot): void {
  const slot = { ...s, scale: floorScale(s.scale, glyph.kind) }
  const list = out.get(glyph.id)
  if (list === undefined) out.set(glyph.id, [slot])
  else list.push(slot)
}

/** one glyph per slot — the seed picks which accents appear, never the geometry */
function assign(glyphs: Glyph[], slots: Slot[], out: SlotMap, rng: Rng): void {
  const order = rng.shuffle(glyphs)
  for (let i = 0; i < Math.min(order.length, slots.length); i++) {
    place(out, order[i] as Glyph, slots[i] as Slot)
  }
}

/** heroes interleave across slots — the same few shapes fill a formation */
function repeat(glyphs: Glyph[], slots: Slot[], out: SlotMap): void {
  if (glyphs.length === 0 || slots.length === 0) return
  for (let i = 0; i < slots.length; i++) place(out, glyphs[i % glyphs.length] as Glyph, slots[i] as Slot)
}

/** contiguous runs of one shape — a stack reads as a column of identical units */
function stack(glyphs: Glyph[], slots: Slot[], out: SlotMap): void {
  if (glyphs.length === 0 || slots.length === 0) return
  const per = Math.ceil(slots.length / glyphs.length)
  for (let i = 0; i < slots.length; i++) place(out, glyphs[Math.floor(i / per) % glyphs.length] as Glyph, slots[i] as Slot)
}

function cloneMap(map: SlotMap): SlotMap {
  return new Map([...map].map(([k, v]) => [k, v.map((s) => ({ ...s }))]))
}

/**
 * sparse constellation — a few large shapes spread wide, still mirrored.
 * Big shapes land first (they anchor, and leave last in the LIFO dissolve);
 * sparkle detail and labels trail in after them.
 */
function marksBeat(groups: GlyphGroups, pkgs: Glyph[], rng: Rng, variant: number): SlotMap {
  const out: SlotMap = new Map()
  const slots =
    variant === 0
      ? [
          { x: 0.44, y: -0.26, rot: 0, scale: 0.13, copies: MIRROR_X, order: 0 },
          { x: 0, y: 0.5, rot: 0, scale: 0.11, copies: SINGLE, order: 0.1 }
        ]
      : [
          { x: 0.5, y: 0.28, rot: 0, scale: 0.12, copies: MIRROR_X, order: 0 },
          { x: 0, y: -0.5, rot: 0, scale: 0.11, copies: SINGLE, order: 0.1 }
        ]
  repeat(pkgs, slots, out)
  assign(
    groups.marks,
    [
      { x: 0.54, y: -0.54, rot: 0, scale: 0.045, copies: QUAD, order: 0.3 },
      { x: 0.3, y: -0.1, rot: PI2, scale: 0.038, copies: MIRROR_X, order: 0.45 },
      { x: 0.18, y: 0.02, rot: PI2, scale: 0.04, copies: MIRROR_X, order: 0.65 },
      { x: 0, y: variant === 0 ? -0.6 : 0.6, rot: 0, scale: 0.035, copies: SINGLE, order: 0.75 }
    ],
    out,
    rng
  )
  assign(
    groups.texts,
    [{ x: 0.36, y: 0.14, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.85 }],
    out,
    rng
  )
  return out
}

/** central column — grows top-down link by link, like the reference's spine */
function spineCore(count: number): Slot[] {
  const slots: Slot[] = []
  for (let i = 0; i < count; i++) {
    const y = 0.55 - (i / Math.max(1, count - 1)) * 1.1
    slots.push({
      x: 0,
      y,
      rot: i % 2 === 0 ? 0 : PI2,
      scale: 0.15,
      copies: SINGLE,
      order: (0.55 + y) / 1.1
    })
  }
  return slots
}

function spineBeat(groups: GlyphGroups, core: Glyph[], density: number, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  repeat(core, spineCore(Math.max(5, Math.round(6 * density))), out)
  assign(
    groups.texts,
    [
      { x: 0.34, y: 0, rot: PI2, scale: 0.07, copies: MIRROR_X, order: 0.75 },
      { x: 0.22, y: -0.62, rot: 0, scale: 0.06, copies: MIRROR_X, order: 0.85 },
      { x: 0.22, y: 0.62, rot: 0, scale: 0.06, copies: MIRROR_X, order: 0.9 }
    ],
    out,
    rng
  )
  assign(
    groups.marks,
    [
      { x: 0.16, y: -0.2, rot: 0, scale: 0.045, copies: MIRROR_X, order: 0.55 },
      { x: 0.16, y: 0.2, rot: 0, scale: 0.045, copies: MIRROR_X, order: 0.6 },
      { x: 0, y: -0.68, rot: 0, scale: 0.04, copies: SINGLE, order: 0.65 },
      { x: 0.44, y: -0.44, rot: 0, scale: 0.035, copies: QUAD, order: 0.95 }
    ],
    out,
    rng
  )
  // long leader rules flanking the column — the reference's framing strokes
  const rule = groups.marks.find((g) => g.id === 'mark:dash')
  if (rule !== undefined) {
    place(out, rule, { x: 0.5, y: 0, rot: PI2, scale: 0.34, copies: MIRROR_X, order: 0.5 })
  }
  return out
}

/** spine + flanking columns — the totem grows without moving the spine;
 *  flanks sprout center-out around the standing column */
function totemBeat(groups: GlyphGroups, spineMap: SlotMap, rng: Rng): SlotMap {
  const out = cloneMap(spineMap)
  const flank: Slot[] = []
  const rows = 6
  for (let i = 0; i < rows; i++) {
    const y = 0.46 - (i / (rows - 1)) * 0.92
    flank.push({ x: 0.3, y, rot: PI2, scale: 0.1, copies: MIRROR_X, order: (0.46 - y) / 0.92 })
  }
  stack(groups.packages.slice(2), flank, out)
  assign(
    groups.marks,
    [
      { x: 0.46, y: -0.3, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.6 },
      { x: 0.46, y: 0.3, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.7 },
      { x: 0.46, y: 0, rot: PI2, scale: 0.035, copies: MIRROR_X, order: 0.8 },
      { x: 0.6, y: 0, rot: 0, scale: 0.03, copies: MIRROR_X, order: 0.9 }
    ],
    out,
    rng
  )
  return out
}

/** twin stacks — the reference's tall mirrored towers, grown center-out */
function columnsBeat(groups: GlyphGroups, density: number, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  const rows = Math.max(5, Math.round(8 * density))
  const stacks: Slot[] = []
  for (let i = 0; i < rows; i++) {
    const y = 0.56 - (i / (rows - 1)) * 1.12
    // towers rise bottom-up — the stack grows like a building going up
    stacks.push({ x: 0.27, y, rot: 0, scale: 0.14, copies: MIRROR_X, order: (0.56 - y) / 1.12 })
  }
  repeat(groups.packages.slice(0, 2), stacks, out)
  assign(
    groups.texts,
    [
      { x: 0.13, y: -0.45, rot: PI2, scale: 0.065, copies: MIRROR_X, order: 0.85 },
      { x: 0.13, y: -0.15, rot: PI2, scale: 0.065, copies: MIRROR_X, order: 0.35 },
      { x: 0.13, y: 0.15, rot: PI2, scale: 0.065, copies: MIRROR_X, order: 0.35 },
      { x: 0.13, y: 0.45, rot: PI2, scale: 0.065, copies: MIRROR_X, order: 0.85 },
      { x: 0.48, y: 0, rot: 0, scale: 0.05, copies: MIRROR_X, order: 0.55 }
    ],
    out,
    rng
  )
  assign(
    groups.marks,
    [
      { x: 0, y: 0, rot: 0, scale: 0.05, copies: SINGLE, order: 0.05 },
      { x: 0, y: -0.4, rot: 0, scale: 0.035, copies: SINGLE, order: 0.75 },
      { x: 0, y: 0.4, rot: 0, scale: 0.035, copies: SINGLE, order: 0.75 },
      { x: 0, y: -0.68, rot: 0, scale: 0.03, copies: SINGLE, order: 0.95 },
      { x: 0, y: 0.68, rot: 0, scale: 0.03, copies: SINGLE, order: 0.95 },
      { x: 0.5, y: -0.56, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.9 },
      { x: 0.5, y: 0.56, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.9 }
    ],
    out,
    rng
  )
  // vertical rules at the frame edge — scale contrast against the stacks
  const rule = groups.marks.find((g) => g.id === 'mark:dash')
  if (rule !== undefined) {
    place(out, rule, { x: 0.62, y: 0, rot: PI2, scale: 0.4, copies: MIRROR_X, order: 0.5 })
  }
  return out
}

/** radial ring — identical glyphs at exact tangents, rotating slowly */
function ringBeat(groups: GlyphGroups, density: number, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  const primaries = Math.max(4, Math.round(6 * density))
  const radius = 0.42
  const slots: Slot[] = []
  for (let i = 0; i < primaries; i++) {
    const a = -PI2 + ((i + 0.5) / primaries) * Math.PI
    slots.push({
      x: Math.cos(a) * radius,
      y: Math.sin(a) * radius,
      rot: a + PI2,
      scale: 0.14,
      copies: MIRROR_X,
      order: (i / (primaries - 1)) * 0.55
    })
  }
  repeat(groups.packages.slice(0, 2), slots, out)
  const inner: Slot[] = []
  for (let i = 0; i < 3; i++) {
    const a = -PI2 + ((i + 0.5) / 3) * Math.PI
    inner.push({ x: Math.cos(a) * 0.16, y: Math.sin(a) * 0.16, rot: 0, scale: 0.035, copies: MIRROR_X, order: 0.8 })
  }
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 3 + (i * Math.PI) / 3
    inner.push({ x: Math.cos(a) * 0.28, y: Math.sin(a) * 0.28, rot: a, scale: 0.028, copies: MIRROR_X, order: 0.85 })
  }
  assign(groups.marks, inner, out, rng)
  assign(
    [...groups.marks].reverse(),
    [
      { x: 0, y: 0, rot: 0, scale: 0.05, copies: SINGLE, order: 0.9 },
      { x: 0, y: -radius - 0.14, rot: 0, scale: 0.04, copies: SINGLE, order: 0.85 },
      { x: 0, y: radius + 0.14, rot: 0, scale: 0.04, copies: SINGLE, order: 0.95 }
    ],
    out,
    rng
  )
  assign(
    groups.texts,
    [
      { x: 0, y: -radius - 0.08, rot: 0, scale: 0.065, copies: SINGLE, order: 0.65 },
      { x: 0, y: radius + 0.08, rot: Math.PI, scale: 0.065, copies: SINGLE, order: 0.7 }
    ],
    out,
    rng
  )
  return out
}

/** quad emblem — ornaments frame first, corners land, then the center
 *  cluster assembles: inner packages, labels, and finally the dense marks */
function quadBeat(groups: GlyphGroups, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  const corner = groups.packages[0]
  if (corner !== undefined) {
    place(out, corner, { x: 0.36, y: -0.36, rot: -Math.PI / 4, scale: 0.19, copies: QUAD, order: 0.25 })
  }
  assign(
    groups.packages.slice(1),
    [
      { x: 0.15, y: -0.15, rot: 0, scale: 0.09, copies: QUAD, order: 0.45 },
      { x: 0.15, y: 0.15, rot: 0, scale: 0.09, copies: QUAD, order: 0.5 },
      { x: 0.34, y: 0, rot: PI2, scale: 0.08, copies: MIRROR_X, order: 0.55 }
    ],
    out,
    rng
  )
  assign(
    groups.texts,
    [
      { x: 0, y: -0.17, rot: 0, scale: 0.07, copies: SINGLE, order: 0.65 },
      { x: 0, y: 0.17, rot: Math.PI, scale: 0.07, copies: SINGLE, order: 0.68 },
      { x: 0.2, y: 0, rot: PI2, scale: 0.045, copies: MIRROR_X, order: 0.72 },
      { x: 0.2, y: -0.3, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.75 },
      { x: 0.2, y: 0.3, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.78 },
      { x: 0, y: -0.28, rot: 0, scale: 0.04, copies: SINGLE, order: 0.7 },
      { x: 0, y: 0.28, rot: Math.PI, scale: 0.04, copies: SINGLE, order: 0.73 }
    ],
    out,
    rng
  )
  assign(
    groups.marks,
    [
      { x: 0.5, y: -0.5, rot: 0, scale: 0.055, copies: QUAD, order: 0.02 },
      { x: 0.5, y: 0.5, rot: 0, scale: 0.055, copies: QUAD, order: 0.05 },
      { x: 0.44, y: 0, rot: Math.PI / 4, scale: 0.04, copies: MIRROR_X, order: 0.08 },
      { x: 0.06, y: -0.06, rot: 0, scale: 0.05, copies: QUAD, order: 0.85 },
      { x: 0.06, y: 0.06, rot: 0, scale: 0.05, copies: QUAD, order: 0.87 },
      { x: 0, y: -0.08, rot: 0, scale: 0.04, copies: SINGLE, order: 0.89 },
      { x: 0, y: 0.08, rot: 0, scale: 0.04, copies: SINGLE, order: 0.91 },
      { x: 0, y: 0, rot: 0, scale: 0.045, copies: SINGLE, order: 0.93 },
      { x: 0.3, y: -0.14, rot: 0, scale: 0.035, copies: QUAD, order: 0.95 },
      { x: 0.3, y: 0.14, rot: 0, scale: 0.035, copies: QUAD, order: 0.97 }
    ],
    out,
    rng
  )
  return out
}

/** cartesian tiling — the top hero repeated in a mirrored grid, marks
 *  orbiting the lattice */
function gridBeat(groups: GlyphGroups, density: number, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  const hero = groups.packages[0]
  if (hero !== undefined) {
    const cols = Math.max(2, Math.round(3 * density))
    const slots: Slot[] = []
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        slots.push({
          x: 0.2 + c * 0.21,
          y: 0.24 + r * 0.36,
          rot: 0,
          scale: 0.12,
          copies: QUAD,
          order: (r * cols + c) / Math.max(1, 2 * cols - 1)
        })
      }
    }
    repeat([hero], slots, out)
  }
  assign(
    groups.marks,
    [
      { x: 0, y: 0.42, rot: 0, scale: 0.04, copies: MIRROR_X, order: 0.8 },
      { x: 0.62, y: 0.42, rot: PI2, scale: 0.035, copies: MIRROR_X, order: 0.7 },
      { x: 0.41, y: 0, rot: 0, scale: 0.035, copies: MIRROR_X, order: 0.75 },
      { x: 0, y: 0, rot: 0, scale: 0.045, copies: SINGLE, order: 0.95 }
    ],
    out,
    rng
  )
  assign(
    groups.texts,
    [
      { x: 0, y: -0.68, rot: 0, scale: 0.05, copies: SINGLE, order: 0.85 },
      { x: 0, y: 0.68, rot: Math.PI, scale: 0.05, copies: SINGLE, order: 0.88 }
    ],
    out,
    rng
  )
  return out
}

/** counter-rotating orbits — two concentric rings of marks around one hero */
function orbitBeat(groups: GlyphGroups, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  const hero = groups.packages[0]
  if (hero !== undefined) {
    place(out, hero, { x: 0, y: 0, rot: 0, scale: 0.22, copies: SINGLE, order: 0.05 })
  }
  // half-ring primaries with mirrorX twins close each circle symmetrically;
  // turn signs make the rings counter-rotate under the hold drift
  const ring = (radius: number, count: number, turn: number, order0: number): Slot[] => {
    const slots: Slot[] = []
    for (let i = 0; i < count; i++) {
      const a = -PI2 + ((i + 0.5) / count) * Math.PI
      slots.push({
        x: Math.cos(a) * radius,
        y: Math.sin(a) * radius,
        rot: a + PI2,
        scale: 0.055,
        copies: MIRROR_X,
        order: order0 + i * 0.04,
        turn
      })
    }
    return slots
  }
  assign(groups.marks, [...ring(0.3, 4, -1, 0.4), ...ring(0.56, 6, 1, 0.55)], out, rng)
  assign(
    groups.texts,
    [{ x: 0, y: -0.68, rot: 0, scale: 0.05, copies: SINGLE, order: 0.9 }],
    out,
    rng
  )
  return out
}

export interface BeatDef {
  id: FormationId
  /** hold span as fractions of the loop; transitions fill the gaps */
  h0: number
  h1: number
}

/** formations that need a real cast of packages to read as hardware */
const NEEDS_PACKAGES: ReadonlySet<FormationId> = new Set(['spine', 'totem'])
const DENSE_POOL: readonly FormationId[] = ['columns', 'ring', 'grid', 'quad', 'spine', 'totem']
const SPARSE_POOL: readonly FormationId[] = ['marks', 'orbit']
/** total hold coverage of the loop; transitions own the rest */
const HOLD_TOTAL = 0.42

/**
 * Board-driven formation arc: the marks residue bookends the loop so the
 * seam shares one map; 5–7 middles alternate sparse/dense with a quad-or-
 * grid climax parked at the last middle — inside the loop's final third.
 * Holds spread evenly, the climax holding 1.4× longer.
 */
export function planBeats(groups: GlyphGroups, rng: Rng): BeatDef[] {
  const dense = DENSE_POOL.filter((d) => !NEEDS_PACKAGES.has(d) || groups.packages.length >= 2)
  const climax = rng.pick(['quad', 'grid'] as const)
  const bench = dense.filter((d) => d !== climax)
  const pools: Record<'d' | 's', FormationId[]> = {
    d: rng.shuffle(bench),
    s: rng.shuffle([...SPARSE_POOL])
  }
  const draw = (cls: 'd' | 's'): FormationId => {
    const pool = pools[cls]
    if (pool.length === 0) pool.push(...rng.shuffle([...(cls === 'd' ? bench : SPARSE_POOL)]))
    return pool.pop() as FormationId
  }

  const middleCount = rng.int(5, 8)
  const middles: FormationId[] = new Array<FormationId>(middleCount)
  middles[middleCount - 1] = climax
  // fill back from the climax alternating sparse/dense — the climax is dense
  // and the opening/closing bookends are marks, so the only possible repeat
  // is a sparse marks at middles[0]
  let cls: 'd' | 's' = 's'
  for (let i = middleCount - 2; i >= 0; i--) {
    middles[i] = draw(cls)
    cls = cls === 'd' ? 's' : 'd'
  }
  if (middles[0] === 'marks') middles[0] = 'orbit'

  const seq: FormationId[] = ['marks', ...middles, 'marks']
  const n = seq.length
  const base = HOLD_TOTAL / (n + 0.4)
  return seq.map((id, i) => {
    // the opening marks holds whole from frame 0 (not centred on the seam),
    // so the first half-second is a formation, not a flash then black
    if (i === 0) return { id, h0: 0, h1: base * 1.3 }
    const h = i === n - 2 ? base * 1.4 : base
    const c = i / (n - 1)
    return { id, h0: Math.max(0, c - h / 2), h1: Math.min(0.999, c + h / 2) }
  })
}

/** half-extent in stage units ([-1,1] = the safe area's short side) */
const FILL_TARGET = 0.8
const FILL_GROWTH_MAX = 1.5

export function buildBeatMaps(
  groups: GlyphGroups,
  density: number,
  rngFor: (label: string) => Rng,
  plan: readonly BeatDef[],
  stageAspect = 1
): Map<number, SlotMap> {
  const maps = new Map<number, SlotMap>()
  // cast order is already hint-ranked — heroes are the head of it, guaranteed
  // slots across the arc; the seed varies marks/texts, not the curation
  const heroes = groups.packages
  let marksSeen = 0
  let spineCache: SlotMap | undefined
  const buildOne = (id: FormationId, key: string): SlotMap => {
    switch (id) {
      case 'marks': {
        const k = marksSeen++
        // each interlude's residue draws from a deeper bench — density keeps
        // widening the used cast instead of recycling the same heroes
        return marksBeat(groups, heroes.slice(2 + k * 3), rngFor(key), k % 2)
      }
      case 'spine': {
        spineCache = spineBeat(groups, heroes.slice(0, 2), density, rngFor(key))
        return spineCache
      }
      case 'totem':
        // totem is spine + flanks — clone the standing column when the plan
        // played one, build a shadow spine when it didn't
        return totemBeat(
          groups,
          spineCache ?? spineBeat(groups, heroes.slice(0, 2), density, rngFor(`${key}:base`)),
          rngFor(key)
        )
      case 'columns':
        return columnsBeat(groups, density, rngFor(key))
      case 'ring':
        return ringBeat(groups, density, rngFor(key))
      case 'quad':
        return quadBeat(groups, rngFor(key))
      case 'grid':
        return gridBeat(groups, density, rngFor(key))
      case 'orbit':
        return orbitBeat(groups, rngFor(key))
    }
  }
  for (let i = 0; i < plan.length; i++) {
    const id = (plan[i] as BeatDef).id
    if (i === plan.length - 1 && id === 'marks' && plan[0]?.id === 'marks') {
      maps.set(i, maps.get(0) as SlotMap)
      continue
    }
    maps.set(i, buildOne(id, `${id}:${i}`))
  }
  // each formation crowns one hero — the largest package slot it holds
  const kindOf = new Map<string, GlyphKind>()
  for (const g of [...groups.packages, ...groups.texts, ...groups.marks]) kindOf.set(g.id, g.kind)
  for (const map of new Set(maps.values())) {
    let best: Slot | undefined
    for (const [gid, slots] of map) {
      if (kindOf.get(gid) !== 'package') continue
      for (const s of slots) if (best === undefined || s.scale > best.scale) best = s
    }
    if (best !== undefined) best.hero = true
  }
  // formations were authored at mixed sizes (quad reached 53% of the safe
  // area, columns 82%); grow each one toward a common fill so every beat
  // holds the frame. Never shrinks, and caps growth so sparse residue stays sparse
  for (const map of new Set(maps.values())) {
    let extent = 0
    for (const slots of map.values()) {
      for (const s of slots) extent = Math.max(extent, Math.abs(s.x) + s.scale / 2, Math.abs(s.y) + s.scale / 2)
    }
    const k = extent > 0 ? Math.min(FILL_GROWTH_MAX, Math.max(1, FILL_TARGET / extent)) : 1
    if (k === 1) continue
    for (const slots of map.values()) {
      for (const s of slots) {
        s.x *= k
        s.y *= k
        s.scale *= k
      }
    }
  }
  // stage is square-normalized: widen slots on wide frames, deepen on tall
  const sx = Math.max(1, stageAspect)
  const sy = Math.max(1, 1 / stageAspect)
  if (sx > 1 || sy > 1) {
    for (const map of new Set(maps.values())) {
      for (const slots of map.values()) {
        for (const s of slots) {
          s.x *= sx
          s.y *= sy
        }
      }
    }
  }
  return maps
}
