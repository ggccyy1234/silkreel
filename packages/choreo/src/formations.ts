import { clamp } from './curves'
import type { Rng } from './rng'
import type { FormationId, Glyph, GlyphKind } from './types'

export type CopySpec = { mode: 'single' } | { mode: 'mirrorX' } | { mode: 'quad' } | { mode: 'rot2' }

export interface Slot {
  x: number
  y: number
  rot: number
  scale: number
  copies: CopySpec
  /** authored arrival order — breaks spacing ties and the decode cascade's
   *  within-band ordering */
  order: number
  /** this slot is the formation's hero — drawn in the palette's head colour */
  hero?: boolean | undefined
}

/** no cast member ever lands smaller than this — below it a glyph is noise */
const SCALE_FLOOR: Record<GlyphKind, number> = { package: 0.12, text: 0.05, mark: 0.035 }
const floorScale = (v: number, kind: GlyphKind): number => Math.max(v, SCALE_FLOOR[kind])

/** JetBrains Mono advance, in em — the renderer draws text at font-size = slot scale */
export const MONO_ADVANCE = 0.6

/** half-extents of one copy's drawn box: text measures its label (rotated
 *  AABB); packages and marks are unit-normalized, so scale/2 on both axes */
export function halfExtents(slot: Slot, glyph: Glyph): { hw: number; hh: number } {
  if (glyph.kind === 'text') {
    const w = (glyph.text?.length ?? 0) * MONO_ADVANCE * slot.scale
    const h = slot.scale
    const c = Math.abs(Math.cos(slot.rot))
    const s = Math.abs(Math.sin(slot.rot))
    return { hw: (c * w + s * h) / 2, hh: (s * w + c * h) / 2 }
  }
  return { hw: slot.scale / 2, hh: slot.scale / 2 }
}

export interface Vec {
  x: number
  y: number
}

/** absolute centre of each drawn copy; coincident copies on an axis collapse to one */
export function copyPositions(slot: Slot): Vec[] {
  switch (slot.copies.mode) {
    case 'single':
      return [{ x: slot.x, y: slot.y }]
    case 'rot2':
      return slot.x === 0 && slot.y === 0
        ? [{ x: 0, y: 0 }]
        : [
            { x: slot.x, y: slot.y },
            { x: -slot.x, y: -slot.y }
          ]
    case 'mirrorX': {
      const xs = slot.x === 0 ? [slot.x] : [slot.x, -slot.x]
      return xs.map((x) => ({ x, y: slot.y }))
    }
    case 'quad': {
      const xs = slot.x === 0 ? [slot.x] : [slot.x, -slot.x]
      const ys = slot.y === 0 ? [slot.y] : [slot.y, -slot.y]
      const out: Vec[] = []
      for (const x of xs) for (const y of ys) out.push({ x, y })
      return out
    }
  }
}

interface SlotBox {
  x: number
  y: number
  hw: number
  hh: number
}

const boxesOverlap = (a: SlotBox, b: SlotBox): boolean =>
  Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh

export interface GlyphGroups {
  packages: Glyph[]
  texts: Glyph[]
  marks: Glyph[]
}

const SINGLE: CopySpec = { mode: 'single' }
const MIRROR_X: CopySpec = { mode: 'mirrorX' }
const QUAD: CopySpec = { mode: 'quad' }
const ROT2: CopySpec = { mode: 'rot2' }
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

/** radial ring — identical glyphs at exact tangents around a still centre */
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
  // inner satellites run as rot2 twins — a 180° fold instead of a mirror, so
  // the ring reads as rotation rather than reflection
  const inner: Slot[] = []
  for (let i = 0; i < 3; i++) {
    const a = -PI2 + ((i + 0.5) / 3) * Math.PI
    inner.push({ x: Math.cos(a) * 0.16, y: Math.sin(a) * 0.16, rot: 0, scale: 0.035, copies: ROT2, order: 0.8 })
  }
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 3 + (i * Math.PI) / 3
    inner.push({ x: Math.cos(a) * 0.28, y: Math.sin(a) * 0.28, rot: a, scale: 0.028, copies: ROT2, order: 0.85 })
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

/** concentric orbits — one hero with two rings of marks; the inner band
 *  pairs by 180° rotation so the halo reads as spin, not reflection */
function orbitBeat(groups: GlyphGroups, rng: Rng): SlotMap {
  const out: SlotMap = new Map()
  const hero = groups.packages[0]
  if (hero !== undefined) {
    place(out, hero, { x: 0, y: 0, rot: 0, scale: 0.22, copies: SINGLE, order: 0.05 })
  }
  const ring = (radius: number, count: number, order0: number, copies: CopySpec): Slot[] => {
    const slots: Slot[] = []
    for (let i = 0; i < count; i++) {
      const a = -PI2 + ((i + 0.5) / count) * Math.PI
      slots.push({
        x: Math.cos(a) * radius,
        y: Math.sin(a) * radius,
        rot: a + PI2,
        scale: 0.055,
        copies,
        order: order0 + i * 0.04
      })
    }
    return slots
  }
  assign(groups.marks, [...ring(0.3, 4, 0.4, ROT2), ...ring(0.56, 6, 0.55, MIRROR_X)], out, rng)
  assign(
    groups.texts,
    [{ x: 0, y: -0.68, rot: 0, scale: 0.05, copies: SINGLE, order: 0.9 }],
    out,
    rng
  )
  return out
}

/**
 * Build the slot map for each requested formation, in order. Applies, per map:
 * hero crowning, the text-collision pass, the [0.38, 0.55] cluster
 * normalization, the text em-height clamp, the pairwise spacing pass, and the
 * aspect spread. `stagePx` converts stage units to output px for the text clamp.
 */
export function buildBeatMaps(
  groups: GlyphGroups,
  density: number,
  rngFor: (label: string) => Rng,
  ids: readonly FormationId[],
  stageAspect = 1,
  stagePx = 432,
  marksVariants?: readonly number[]
): Map<number, SlotMap> {
  const maps = new Map<number, SlotMap>()
  // cast order is already hint-ranked — heroes are the head of it
  const heroes = groups.packages
  let marksSeen = 0
  const buildOne = (id: FormationId, key: string): SlotMap => {
    switch (id) {
      case 'marks': {
        const k = marksSeen++
        // each interlude's residue draws from a deeper bench — density keeps
        // widening the used cast instead of recycling the same heroes
        return marksBeat(groups, heroes.slice(2 + k * 3), rngFor(key), marksVariants?.[k] ?? k % 2)
      }
      case 'columns':
        return columnsBeat(groups, density, rngFor(key))
      case 'ring':
        return ringBeat(groups, density, rngFor(key))
      case 'quad':
        return quadBeat(groups, rngFor(key))
      case 'orbit':
        return orbitBeat(groups, rngFor(key))
      case 'ghost':
        return new Map() // the ghost carries raw silk strokes, not slots
    }
  }
  for (let i = 0; i < ids.length; i++) {
    maps.set(i, buildOne(ids[i] as FormationId, `${ids[i]}:${i}`))
  }
  // each formation crowns one hero — the largest package slot it holds
  const glyphById = new Map<string, Glyph>()
  for (const g of [...groups.packages, ...groups.texts, ...groups.marks]) glyphById.set(g.id, g)
  for (const map of new Set(maps.values())) {
    let best: Slot | undefined
    for (const [gid, slots] of map) {
      if (glyphById.get(gid)?.kind !== 'package') continue
      for (const s of slots) if (best === undefined || s.scale > best.scale) best = s
    }
    if (best !== undefined) best.hero = true
  }
  // text slots are authored blind to label width — a long string overruns its
  // box and paints over neighbours. Shrink each label until it clears every
  // package/mark box, every already-placed label, and its own symmetry twins;
  // a label still colliding at the floor is noise — drop the slot.
  const TEXT_GAP = 0.01
  for (const map of new Set(maps.values())) {
    const obstacles: SlotBox[] = []
    const labels: Array<{ glyph: Glyph; slot: Slot }> = []
    for (const [gid, slots] of map) {
      const glyph = glyphById.get(gid)
      if (glyph === undefined) continue
      for (const s of slots) {
        if (glyph.kind === 'text') {
          labels.push({ glyph, slot: s })
        } else {
          const { hw, hh } = halfExtents(s, glyph)
          for (const p of copyPositions(s)) {
            obstacles.push({ x: p.x, y: p.y, hw: hw + TEXT_GAP, hh: hh + TEXT_GAP })
          }
        }
      }
    }
    labels.sort((a, b) => a.slot.order - b.slot.order)
    for (const { glyph, slot } of labels) {
      let boxes: SlotBox[] = []
      for (;;) {
        const { hw, hh } = halfExtents(slot, glyph)
        boxes = copyPositions(slot).map((p) => ({ x: p.x, y: p.y, hw: hw + TEXT_GAP, hh: hh + TEXT_GAP }))
        const clear = boxes.every(
          (b, i) =>
            obstacles.every((o) => !boxesOverlap(b, o)) && boxes.slice(0, i).every((o) => !boxesOverlap(b, o))
        )
        if (clear) break
        if (slot.scale <= SCALE_FLOOR.text + 1e-9) {
          boxes = []
          break
        }
        slot.scale = Math.max(SCALE_FLOOR.text, slot.scale * 0.9)
      }
      if (boxes.length > 0) {
        obstacles.push(...boxes)
      } else {
        const list = map.get(glyph.id)
        if (list !== undefined) {
          const rest = list.filter((s) => s !== slot)
          if (rest.length === 0) map.delete(glyph.id)
          else map.set(glyph.id, rest)
        }
      }
    }
  }
  // normalize every formation's cluster to a ~0.5 half-extent — the tight
  // island in negative space — growing sparse beats and shrinking dense ones
  const extentOf = (map: SlotMap): number => {
    let extent = 0
    for (const [gid, slots] of map) {
      const glyph = glyphById.get(gid)
      if (glyph === undefined) continue
      for (const s of slots) {
        const { hw, hh } = halfExtents(s, glyph)
        for (const p of copyPositions(s)) {
          extent = Math.max(extent, Math.abs(p.x) + hw, Math.abs(p.y) + hh)
        }
      }
    }
    return extent
  }
  for (const map of new Set(maps.values())) {
    const extent = extentOf(map)
    if (extent <= 0) continue
    const k = clamp(0.5 / extent, 0.55, 1.3)
    for (const slots of map.values()) {
      for (const s of slots) {
        s.x *= k
        s.y *= k
        s.scale *= k
      }
    }
  }
  // text renders at font-size = scale × stagePx — pin every label to an
  // 18–26px em so words stay legible without dwarfing the glyphs
  for (const map of new Set(maps.values())) {
    for (const [gid, slots] of map) {
      if (glyphById.get(gid)?.kind !== 'text') continue
      for (const s of slots) {
        s.scale = clamp(s.scale, 18 / stagePx, 26 / stagePx)
      }
    }
  }
  // spacing: two copies whose boxes nearly touch read as one blob — keep the
  // higher-priority slot (packages > texts > marks; heroes are untouchable;
  // ties keep the later arrival)
  const PRIORITY: Record<GlyphKind, number> = { mark: 0, text: 1, package: 2 }
  for (const map of new Set(maps.values())) {
    interface Unit {
      gid: string
      slot: Slot
      kind: GlyphKind
      boxes: SlotBox[]
    }
    const units: Unit[] = []
    for (const [gid, slots] of map) {
      const glyph = glyphById.get(gid)
      if (glyph === undefined) continue
      for (const slot of slots) {
        const { hw, hh } = halfExtents(slot, glyph)
        units.push({
          gid,
          slot,
          kind: glyph.kind,
          boxes: copyPositions(slot).map((p) => ({ x: p.x, y: p.y, hw, hh }))
        })
      }
    }
    const dead = new Set<Slot>()
    for (let i = 0; i < units.length; i++) {
      const a = units[i] as Unit
      if (dead.has(a.slot)) continue
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j] as Unit
        if (dead.has(b.slot)) continue
        if (a.slot === b.slot) continue
        const gap = 0.4 * Math.min(a.slot.scale, b.slot.scale)
        const tooClose = a.boxes.some((ba) =>
          b.boxes.some((bb) =>
            Math.abs(ba.x - bb.x) < ba.hw + bb.hw + gap &&
            Math.abs(ba.y - bb.y) < ba.hh + bb.hh + gap
          )
        )
        if (!tooClose) continue
        // heroes win; otherwise punct < text < support; equal rank drops the
        // earlier (lower-order) slot
        const aPrio = (a.slot.hero === true ? 3 : PRIORITY[a.kind]) * 10 + a.slot.order
        const bPrio = (b.slot.hero === true ? 3 : PRIORITY[b.kind]) * 10 + b.slot.order
        dead.add(aPrio < bPrio ? a.slot : b.slot)
        if (dead.has(a.slot)) break
      }
    }
    if (dead.size > 0) {
      for (const [gid, slots] of [...map]) {
        const rest = slots.filter((s) => !dead.has(s))
        if (rest.length === 0) map.delete(gid)
        else if (rest.length !== slots.length) map.set(gid, rest)
      }
    }
  }
  // the safe rect is wider/taller than square — spread positions a little
  // along the long axis (glyph size stays)
  const sx = stageAspect > 1 ? Math.min(1.15, stageAspect) : 1
  const sy = stageAspect < 1 ? Math.min(1.15, 1 / stageAspect) : 1
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
