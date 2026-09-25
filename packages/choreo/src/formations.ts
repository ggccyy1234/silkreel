import type { Rng } from './rng'
import type { FormationId, Glyph } from './types'

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
}

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
  const list = out.get(glyph.id)
  if (list === undefined) out.set(glyph.id, [s])
  else list.push(s)
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
  return new Map([...map].map(([k, v]) => [k, [...v]]))
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

export interface BeatDef {
  id: FormationId
  /** hold span as fractions of the loop; transitions fill the gaps */
  h0: number
  h1: number
}

/**
 * the reference's real arc: three density waves, each building and fully
 * dissolving. residue constellations hold the valleys between waves and at
 * the loop seam — the first and last marks beats share one map so the wrap
 * is seamless.
 */
export const BEATS: readonly BeatDef[] = [
  { id: 'marks', h0: 0.0, h1: 0.025 },
  { id: 'spine', h0: 0.19, h1: 0.235 },
  { id: 'totem', h0: 0.32, h1: 0.36 },
  { id: 'marks', h0: 0.44, h1: 0.48 },
  { id: 'columns', h0: 0.58, h1: 0.645 },
  { id: 'marks', h0: 0.69, h1: 0.72 },
  { id: 'ring', h0: 0.755, h1: 0.81 },
  { id: 'quad', h0: 0.855, h1: 0.9 },
  { id: 'marks', h0: 0.945, h1: 0.999 }
]

export function buildBeatMaps(
  groups: GlyphGroups,
  density: number,
  rngFor: (label: string) => Rng
): Map<number, SlotMap> {
  const maps = new Map<number, SlotMap>()
  // cast order is already hint-ranked — heroes are the head of it, guaranteed
  // slots across the arc; the seed varies marks/texts, not the curation
  const heroes = groups.packages
  const marksA = marksBeat(groups, heroes.slice(2), rngFor('marks:a'), 0)
  const spine = spineBeat(groups, heroes.slice(0, 2), density, rngFor('spine'))
  maps.set(0, marksA)
  maps.set(1, spine)
  maps.set(2, totemBeat(groups, spine, rngFor('totem')))
  maps.set(3, marksBeat(groups, heroes.slice(4), rngFor('marks:b'), 1))
  maps.set(4, columnsBeat(groups, density, rngFor('columns')))
  maps.set(5, marksBeat(groups, heroes.slice(6), rngFor('marks:c'), 0))
  maps.set(6, ringBeat(groups, density, rngFor('ring')))
  maps.set(7, quadBeat(groups, rngFor('quad')))
  maps.set(8, marksA)
  return maps
}
