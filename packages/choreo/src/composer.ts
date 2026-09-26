import type { BoardModel } from '@silk-reel/ingest'
import { clamp, clamp01, smooth01 } from './curves'
import { BEATS, buildBeatMaps } from './formations'
import { safeArea } from './layout'
import type { CopySpec, GlyphGroups, Slot } from './formations'
import { buildCast } from './glyphs'
import { makeRng } from './rng'
import type { ResolvedConfig } from './config'
import type {
  AtomState,
  FormationEvent,
  FormationId,
  Glyph,
  GlyphKind,
  TimelineWarning,
  Track,
  TrackKnot
} from './types'

/**
 * holds are planted — the reference rests its formations and lets only the
 * alpha shimmer breathe (the ring's slow turn is the one sustained motion).
 * dx breathes along the mirror axis, grow swells; translations read as slide.
 */
interface HoldDrift {
  rot?: number
  dx?: number
  dy?: number
  grow?: number
}
const HOLD_DRIFT: Partial<Record<FormationId, HoldDrift>> = {
  marks: { dy: -0.011 },
  spine: { grow: 1.012 },
  totem: { grow: 1.01 },
  columns: { dx: 0.005 },
  ring: { rot: 0.1 },
  quad: { grow: 0.96 }
}
/** transition choreography scales with formation size: a residue exits in a
 *  blink, a dense act needs its full dissolve; the reveal overlaps the evac
 *  tail — a breath between waves, not a dead gap */
const evacShare = (nOut: number): number => (nOut === 0 ? 0 : clamp(0.08 + nOut * 0.014, 0.08, 0.55))
const buildShare = (nIn: number): number => (nIn === 0 ? 0 : clamp(0.15 + nIn * 0.03, 0.15, 0.9))

export interface ComposeResult {
  cast: Glyph[]
  tracks: Track[]
  formations: FormationEvent[]
  warnings: TimelineWarning[]
}

function rotate(p: { x: number; y: number }, a: number): { x: number; y: number } {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** expand one slot's symmetry copies into absolute atoms, sorted canonically */
function expand(copies: CopySpec, base: AtomState, drift: HoldDrift | undefined): AtomState[] {
  let atoms: AtomState[]
  switch (copies.mode) {
    case 'single':
      atoms = [base]
      break
    case 'mirrorX':
      atoms = [base, { ...base, x: -base.x, rot: -base.rot, flipX: true }]
      break
    case 'quad':
      atoms = [
        base,
        { ...base, x: -base.x, rot: -base.rot, flipX: true },
        { ...base, y: -base.y, rot: -base.rot, flipY: true },
        { ...base, x: -base.x, y: -base.y, rot: base.rot, flipX: true, flipY: true }
      ]
      break
  }
  if (drift !== undefined) {
    atoms = atoms.map((at) => {
      let { x, y, scale } = at
      // mirror twins counter-rotate: the fold stays exactly Y-symmetric
      // instead of tilting the whole formation off-axis; axis singles pinned
      if (drift.rot !== undefined && copies.mode !== 'single') {
        const p = rotate({ x, y }, at.flipX === true ? -drift.rot : drift.rot)
        x = p.x
        y = p.y
      }
      // dx slides each atom outward along its own side; dy shifts the pair
      // together — both preserve mirror symmetry
      if (drift.dx !== undefined) x += drift.dx * Math.sign(x)
      if (drift.dy !== undefined) y += drift.dy
      if (drift.grow !== undefined) scale *= drift.grow
      return { ...at, x, y, scale }
    })
  }
  atoms.sort((a, b) => {
    const aa = Math.atan2(a.y, a.x)
    const ba = Math.atan2(b.y, b.x)
    if (aa !== ba) return aa - ba
    return Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)
  })
  return atoms
}

function slotAtoms(slots: Slot[], alpha: number, drift: HoldDrift | undefined): AtomState[] {
  const atoms = slots.flatMap((s) =>
    expand(s.copies, { x: s.x, y: s.y, rot: s.rot, scale: s.scale, alpha, order: s.order }, drift)
  )
  atoms.sort((a, b) => {
    const aa = Math.atan2(a.y, a.x)
    const ba = Math.atan2(b.y, b.x)
    if (aa !== ba) return aa - ba
    return Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)
  })
  return atoms
}

function groupCast(cast: Glyph[]): GlyphGroups {
  const groups: GlyphGroups = { packages: [], texts: [], marks: [] }
  for (const g of cast) {
    if (g.kind === 'package') groups.packages.push(g)
    else if (g.kind === 'text') groups.texts.push(g)
    else groups.marks.push(g)
  }
  return groups
}

export function composeFilm(board: BoardModel, resolved: ResolvedConfig, seed: number): ComposeResult {
  const warnings: TimelineWarning[] = []
  const { cast, warnings: castWarnings } = buildCast(
    board,
    resolved.knobs.density,
    resolved.knobs.texts >= 0.5,
    makeRng(seed, 'cast'),
    resolved.cast
  )
  warnings.push(...castWarnings)
  const groups = groupCast(cast)

  const safe = safeArea(resolved.width, resolved.height, resolved.title !== undefined)
  const beatMaps = buildBeatMaps(
    groups,
    resolved.knobs.density,
    (label) => makeRng(seed, `form:${label}`),
    safe.w / safe.h
  )

  const n = BEATS.length
  // dormant beats borrow the nearest active slots so the glyph evaporates
  // in place, then pops back in at its next active slot
  const slotsFor = (glyphId: string, bi: number): Slot[] | undefined => {
    for (let d = 0; d < n; d++) {
      const prev = beatMaps.get((bi - d + n) % n)?.get(glyphId)
      if (prev !== undefined) return prev
      const next = beatMaps.get((bi + d) % n)?.get(glyphId)
      if (d > 0 && next !== undefined) return next
    }
    return undefined
  }

  // per-glyph enter/depart atom sets per beat
  const beatAtoms = new Map<string, Array<{ enter: AtomState[]; depart: AtomState[] }>>()
  for (const glyph of cast) {
    const rngAlpha = makeRng(seed, `alpha:${glyph.id}`)
    const beats: Array<{ enter: AtomState[]; depart: AtomState[] }> = []
    for (let bi = 0; bi < n; bi++) {
      const beat = BEATS[bi] as { id: FormationId; h0: number; h1: number }
      const slots = slotsFor(glyph.id, bi)
      if (slots === undefined) break
      const active = beatMaps.get(bi)?.has(glyph.id) === true
      const alpha = active ? 0.85 + rngAlpha.range(0, 0.15) : 0
      beats.push({
        enter: slotAtoms(slots, alpha, undefined),
        depart: slotAtoms(slots, alpha, HOLD_DRIFT[beat.id])
      })
    }
    beatAtoms.set(glyph.id, beats)
  }

  // each transition bracket gets ONE global evac/dead/build split, sized by
  // the whole formation wave — the per-track sampler shares it
  const brackets: Array<{ evacEnd: number; buildStart: number }> = []
  for (let bi = 0; bi < n; bi++) {
    const bn = (bi + 1) % n
    let nOut = 0
    let nIn = 0
    for (const beats of beatAtoms.values()) {
      const a = beats[bi]
      const b = beats[bn]
      if (a === undefined || b === undefined) continue
      const s = bracketShape(a.depart, b.enter)
      nOut += s.nOut
      nIn += s.nIn
    }
    const evacEnd = evacShare(nOut)
    // overlap: the build may start while the last evac atoms fade; the dead
    // gap between the waves is capped at a breath of the bracket
    const buildStart = nIn === 0 ? 1 : clamp(1 - buildShare(nIn), evacEnd * 0.5, evacEnd + 0.04)
    brackets.push({ evacEnd, buildStart })
  }

  const tracks: Track[] = []
  for (const glyph of cast) {
    const beats = beatAtoms.get(glyph.id) ?? []
    const knots: TrackKnot[] = []
    for (let bi = 0; bi < beats.length; bi++) {
      const beat = BEATS[bi] as { id: FormationId; h0: number; h1: number }
      const atoms = beats[bi] as { enter: AtomState[]; depart: AtomState[] }
      knots.push({ phase: beat.h0, atoms: atoms.enter })
      knots.push({ phase: beat.h1, atoms: atoms.depart, transit: brackets[bi] })
    }
    knots.sort((a, b) => a.phase - b.phase)
    tracks.push({ glyphId: glyph.id, kind: glyph.kind, knots })
  }

  // a cast glyph no beat picked draws nothing — drop it from the film
  const usedIds = new Set(tracks.filter((t) => t.knots.length > 0).map((t) => t.glyphId))
  const activeTracks = tracks.filter((t) => t.knots.length > 0)
  const activeCast = cast.filter((g) => usedIds.has(g.id))

  const formations: FormationEvent[] = BEATS.map((beat, i) => ({
    id: beat.id,
    startPhase: beat.h0,
    endPhase: beat.h1,
    beat: i
  }))
  return { cast: activeCast, tracks: activeTracks, formations, warnings }
}

/** positions match within tolerance — the "same" atom persisting or arriving */
function sameAtom(a: AtomState, b: AtomState): boolean {
  return (
    Math.abs(b.x - a.x) < 0.015 &&
    Math.abs(b.y - a.y) < 0.015 &&
    Math.abs(b.rot - a.rot) < 0.06 &&
    Math.abs(b.scale - a.scale) < 0.02
  )
}

/**
 * Shape of a whole bracket across all tracks: how many orbits dissolve
 * (visible in k0, gone in k1) and how many reveal (visible in k1, hidden in
 * k0). Sizes the global evac/dead/build split.
 */
function bracketShape(k0Atoms: AtomState[], k1Atoms: AtomState[]): { nOut: number; nIn: number } {
  const orbits0 = orbitize(k0Atoms)
  const orbits1 = orbitize(k1Atoms)
  const used = new Array<boolean>(orbits1.length).fill(false)
  let nOut = 0
  let nIn = 0
  for (const o0 of orbits0) {
    const a = o0[1]
    let j = -1
    for (let k = 0; k < orbits1.length; k++) {
      if (used[k] === true) continue
      const b = orbits1[k]?.[1]
      if (b !== undefined && b.alpha > 0.05 && sameAtom(a, b)) {
        j = k
        break
      }
    }
    if (j >= 0) {
      used[j] = true
      // dormant → visible counts toward the reveal wave
      if (a.alpha <= 0.05) nIn++
    } else if (a.alpha > 0.05) nOut++
  }
  for (let k = 0; k < orbits1.length; k++) {
    const b = orbits1[k]?.[1]
    if (used[k] !== true && b !== undefined && b.alpha > 0.05) nIn++
  }
  return { nOut, nIn }
}

/** interpolate a track's atoms at cyclic phase p ∈ [0,1) */
export function sampleTrack(track: Track, p: number): AtomState[] {
  const knots = track.knots
  if (knots.length === 0) return []
  const phase = ((p % 1) + 1) % 1
  let i0 = knots.length - 1
  for (let i = 0; i < knots.length; i++) {
    if ((knots[i] as TrackKnot).phase <= phase) i0 = i
    else break
  }
  const k0 = knots[i0] as TrackKnot
  const k1 = knots[(i0 + 1) % knots.length] as TrackKnot
  const span = (k1.phase - k0.phase + 1) % 1
  if (span <= 0) return k0.atoms
  const t = clamp01(((phase - k0.phase + 1) % 1) / span)
  const orbits0 = orbitize(k0.atoms)
  const orbits1 = orbitize(k1.atoms)
  const out: AtomState[] = []

  // every emission derives its mirror twin — symmetry is structural
  const emit = (o: Orbit, primary: AtomState): void => {
    out.push(primary)
    if (o[0] !== o[1]) {
      out.push({ ...primary, x: -primary.x, rot: -primary.rot, flipX: !(primary.flipX === true) })
    }
  }

  if (k0.transit === undefined) {
    // inside a hold: same atom set; lerp is only for slow drift (the ring).
    // the twinkle swells mid-hold and dies at the knots so plateaus breathe
    // asynchronously — never a step at the boundary, never frozen solid
    const e = t * t * (3 - 2 * t)
    const swell = Math.sin(Math.PI * t)
    const count = Math.max(orbits0.length, orbits1.length)
    for (let i = 0; i < count; i++) {
      const o0 = orbits0[i]
      const o1 = orbits1[i]
      if (o0 === undefined || o1 === undefined) continue
      const a = o0[1]
      const b = o1[1]
      const dr = (((b.rot - a.rot + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      // per-orbit depth — a few elements twinkle deep, most barely move;
      // shimmer must never read as a global flicker. tiny marks breathe
      // deeper: sparse residue pulses audibly where a tower would flicker
      const depth = 0.4 + 0.6 * ((i * 0.318) % 1)
      const amp = 0.03 + 0.09 * clamp01(1 - a.scale / 0.07)
      const twinkle = 1 + amp * depth * swell * Math.sin(Math.PI * 2 * (t * 1.5 + i * 0.618))
      emit(o0, {
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
        rot: a.rot + dr * e,
        scale: a.scale + (b.scale - a.scale) * e,
        alpha: Math.min(1, (a.alpha + (b.alpha - a.alpha) * e) * twinkle),
        flipX: a.flipX ?? b.flipX,
        flipY: a.flipY ?? b.flipY
      })
    }
    return out
  }

  // transition: nothing glides — the old formation evaporates in place
  // (last-in-first-out), the stage sits empty, then the new one pops in
  // staggered by its spatial script.
  const used = new Array<boolean>(orbits1.length).fill(false)
  // a pop is an atom becoming (or staying) visible at its k1 pose
  interface Pop {
    o: Orbit
    a: AtomState
    b: AtomState
  }
  const persisting: Pop[] = [] // visible → visible (cloned slots, wraps)
  const popPool: Pop[] = []    // hidden → visible: the reveal wave
  const departing: Orbit[] = [] // visible → gone: the dissolve wave
  for (const o0 of orbits0) {
    const a = o0[1]
    let j = -1
    for (let k = 0; k < orbits1.length; k++) {
      if (used[k] === true) continue
      const b = orbits1[k]?.[1]
      // only an active destination keeps the atom on stage — a dormant
      // borrowed slot means this atom is genuinely leaving
      if (b !== undefined && b.alpha > 0.05 && sameAtom(a, b)) {
        j = k
        break
      }
    }
    if (j >= 0) {
      used[j] = true
      const b = orbits1[j]?.[1] as AtomState
      if (a.alpha > 0.05) persisting.push({ o: o0, a, b })
      else popPool.push({ o: o0, a, b })
    } else if (a.alpha > 0.05) departing.push(o0)
  }
  for (let k = 0; k < orbits1.length; k++) {
    if (used[k] === true) continue
    const o1 = orbits1[k] as Orbit
    const b = o1[1]
    if (b.alpha > 0.05) popPool.push({ o: o1, a: { ...b, alpha: 0 }, b })
  }

  // the global split for this bracket — every track rides the same wave
  const { evacEnd, buildStart } = k0.transit
  const evacDur = clamp(evacEnd * 0.4, 0.05, 0.16)
  const popDur = clamp((1 - buildStart) * 0.25, 0.05, 0.18)

  // literal order picks the sequence; rank spreads the pops across the
  // window so a whole group doesn't land in one frame — steady trickle
  // with occasional bursts, like the reference
  const byOrder = <T>(list: T[], key: (e: T) => AtomState): T[] =>
    [...list].sort((p, q) => {
      const pa = key(p)
      const qa = key(q)
      const d = (pa.order ?? 0.5) - (qa.order ?? 0.5)
      return d !== 0 ? d : pa.x - qa.x || pa.y - qa.y
    })
  const popSorted = byOrder(popPool, (p) => p.b)
  const departingSorted = byOrder(departing, (o) => o[1])

  const settle = (a: AtomState, b: AtomState, ramp: number): AtomState => {
    const dr = (((b.rot - a.rot + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI
    return {
      ...b,
      x: a.x + (b.x - a.x) * ramp,
      y: a.y + (b.y - a.y) * ramp,
      rot: a.rot + dr * ramp,
      scale: a.scale + (b.scale - a.scale) * ramp,
      alpha: a.alpha + (b.alpha - a.alpha) * ramp
    }
  }

  // quiet brackets still breathe — async twinkle swelling in the dead gap,
  // silent at the knots so holds and transitions hand off seamlessly
  const shimmer = (i: number, scale: number): number =>
    1 +
    (0.03 + 0.09 * clamp01(1 - scale / 0.07)) *
      (0.4 + 0.6 * ((i * 0.318) % 1)) *
      Math.sin(Math.PI * t) *
      Math.sin(Math.PI * 2 * (t * 1.5 + i * 0.618))

  // arrivals decelerate into place, never ease-in-out: opacity snaps inside
  // the first third of the pop while a two-phase scale overshoot carries the
  // landing — heroes settle longer than marks (velocity varies by weight)
  const KIND_POP: Record<GlyphKind, { dur: number; from: number; over: number }> = {
    package: { dur: 1.25, from: 0.86, over: 1.045 },
    text: { dur: 0.9, from: 0.9, over: 1.03 },
    mark: { dur: 0.7, from: 0.8, over: 1.07 }
  }
  const kp = KIND_POP[track.kind]
  const popDurK = popDur * kp.dur
  const popScaleAt = (ramp: number): number => {
    if (ramp < 0.6) {
      const u = ramp / 0.6
      return kp.from + (kp.over - kp.from) * (1 - (1 - u) * (1 - u))
    }
    const u = (ramp - 0.6) / 0.4
    return kp.over - (kp.over - 1) * (u * u * (3 - 2 * u))
  }
  // shrinking gaps: the cascade accelerates — sparse scouts, bunching tail,
  // a synchronized snap as the last details land together
  const accel = (rank: number): number => 1 - Math.pow(1 - rank, 1.7)

  for (const [i, p] of persisting.entries()) {
    const start = buildStart + (p.b.order ?? 0.5) * Math.max(0, 1 - buildStart - popDur)
    const s = settle(p.a, p.b, smooth01(clamp01((t - start) / popDur)))
    emit(p.o, { ...s, alpha: Math.min(1, s.alpha * shimmer(i, s.scale)) })
  }
  const nPop = Math.max(1, popSorted.length - 1)
  for (let i = 0; i < popSorted.length; i++) {
    const p = popSorted[i] as Pop
    // literal order picks WHO arrives when; the accelerating schedule gives
    // rhythm inside the window — order is the script, accel is the tempo
    const eff = 0.6 * (p.b.order ?? 0.5) + 0.4 * accel(i / nPop)
    // the scout: the first-ranked atom lands ahead of the wave, alone in the gap
    let start = buildStart + eff * Math.max(0, 1 - buildStart - popDurK)
    if (i === 0) start = Math.max(buildStart, start - 0.07)
    const ramp = clamp01((t - start) / popDurK)
    const s = settle(p.a, p.b, smooth01(ramp))
    const alpha = p.b.alpha * smooth01(clamp01(ramp / 0.32))
    emit(p.o, { ...s, alpha: Math.min(1, alpha * shimmer(i, s.scale)), scale: s.scale * popScaleAt(ramp) })
  }
  const nOut = Math.max(1, departingSorted.length - 1)
  for (let i = 0; i < departingSorted.length; i++) {
    const o0 = departingSorted[i] as Orbit
    const a = o0[1]
    // last in, first out — the outer wave snaps off together and the peel
    // decelerates inward; each exit accelerates as it fades
    const eff = 0.6 * (a.order ?? 0.5) + 0.4 * accel(i / nOut)
    const start = (1 - eff) * Math.max(0, evacEnd - evacDur)
    const fade = Math.pow(clamp01((t - start) / evacDur), 1.6)
    emit(o0, { ...a, alpha: Math.min(1, a.alpha * (1 - fade) * shimmer(i, a.scale)), scale: a.scale * (1 - 0.12 * fade) })
  }
  return out
}

/** a mirror pair: [left member (x<=0), right member (x>=0)] */
type Orbit = [AtomState, AtomState]

/**
 * Group atoms into mirror pairs keyed on (|x|, y). Each knot's atom set is a
 * union of such pairs by construction; orbit order is canonical (by the right
 * member's angle) so pairing across knots is deterministic.
 */
function orbitize(atoms: AtomState[]): Orbit[] {
  const sorted = [...atoms].sort((a, b) => a.x - b.x || a.y - b.y || a.rot - b.rot)
  const used = new Array<boolean>(sorted.length).fill(false)
  const orbits: Orbit[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (used[i] === true) continue
    used[i] = true
    const a = sorted[i] as AtomState
    let best = -1
    let bestScore = Infinity
    for (let j = i + 1; j < sorted.length; j++) {
      if (used[j] === true) continue
      const b = sorted[j] as AtomState
      const score = Math.abs(b.x + a.x) + Math.abs(b.y - a.y)
      if (score < bestScore) {
        bestScore = score
        best = j
      }
    }
    if (best >= 0) {
      used[best] = true
      const b = sorted[best] as AtomState
      orbits.push(a.x <= b.x ? [a, b] : [b, a])
    } else {
      // self-symmetric atom on the axis — pair it with itself
      orbits.push([a, a])
    }
  }
  orbits.sort((o1, o2) => {
    const a1 = Math.atan2(o1[1].y, o1[1].x)
    const a2 = Math.atan2(o2[1].y, o2[1].x)
    return a1 !== a2 ? a1 - a2 : Math.hypot(o1[1].x, o1[1].y) - Math.hypot(o2[1].x, o2[1].y)
  })
  return orbits
}
