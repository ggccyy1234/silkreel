import type { BoardModel } from '@silk-reel/ingest'
import { buildBeatMaps } from './formations'
import type { CopySpec, GlyphGroups, Slot } from './formations'
import { buildGhostGeometry } from './ghost'
import { safeArea } from './layout'
import { buildCast } from './glyphs'
import { makeRng } from './rng'
import type { ResolvedConfig } from './config'
import type {
  AtomState,
  FormationEvent,
  FormationId,
  Glyph,
  GlyphGhost,
  Placement,
  TimelineWarning,
  Tone
} from './types'

/**
 * The loop runs on a 15fps decode grid: nothing moves, units blink in, hold,
 * and blink out. The arc is fixed — sparse opening, dense middle, quad
 * climax, the board-ghost signature, a closing residue, and a seam mark that
 * rides across the wrap so step 0 is never empty.
 */

/** decode steps per beat — the beat grid every arc lands on */
export const BEAT_STEPS = 7
/** a full pass through the arc is 24 beats */
const ARC_BEATS = 24

interface ArcBand {
  inBeat: number
  inSpread: number
  outBeat: number
  outSpread: number
  /** rank direction for the decode cascade */
  cascade: 'center-out' | 'edges-in' | 'heroes-first'
}

/** per-formation arc placement, in beats (arc table in the taste brief) */
const ARC: Record<'A' | 'B' | 'C' | 'ghost' | 'D', ArcBand> = {
  A: { inBeat: 1, inSpread: 2, outBeat: 7.5, outSpread: 1, cascade: 'center-out' },
  B: { inBeat: 8, inSpread: 2, outBeat: 13.5, outSpread: 1, cascade: 'center-out' },
  C: { inBeat: 14, inSpread: 1.5, outBeat: 16, outSpread: 0.5, cascade: 'edges-in' },
  ghost: { inBeat: 16.5, inSpread: 1, outBeat: 19.5, outSpread: 0.5, cascade: 'heroes-first' },
  D: { inBeat: 20, inSpread: 1.5, outBeat: 22.5, outSpread: 0.5, cascade: 'center-out' }
}
/** the seam mark wraps the loop boundary alone */
const SEAM_IN_BEAT = 22
const SEAM_OUT_BEAT = 1.5

const KIND_ROLE: Record<string, Tone> = { package: 'support', mark: 'punct', text: 'text' }

export interface ComposeResult {
  cast: Glyph[]
  placements: Placement[]
  formations: FormationEvent[]
  steps: number
  cadence: 'twos' | 'smooth'
  ghost: GlyphGhost
  glints: Array<{ placement: number; step: number }>
  warnings: TimelineWarning[]
}

/** expand one slot's symmetry copies into absolute atoms */
function expand(copies: CopySpec, base: AtomState): AtomState[] {
  switch (copies.mode) {
    case 'single':
      return [base]
    case 'rot2':
      if (base.x === 0 && base.y === 0) return [base]
      return [base, { ...base, x: -base.x, y: -base.y, rot: base.rot + Math.PI }]
    case 'mirrorX':
      return base.x === 0
        ? [base]
        : [base, { ...base, x: -base.x, rot: -base.rot, flipX: true }]
    case 'quad': {
      const atoms: AtomState[] = [base]
      if (base.x !== 0) atoms.push({ ...base, x: -base.x, rot: -base.rot, flipX: true })
      if (base.y !== 0) atoms.push({ ...base, y: -base.y, rot: -base.rot, flipY: true })
      if (base.x !== 0 && base.y !== 0) {
        atoms.push({ ...base, x: -base.x, y: -base.y, rot: base.rot, flipX: true, flipY: true })
      }
      return atoms
    }
  }
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

export function composeFilm(
  board: BoardModel,
  resolved: ResolvedConfig,
  seed: number,
  durationSeconds: number
): ComposeResult {
  const warnings: TimelineWarning[] = []
  const { cast, warnings: castWarnings, heroRefs } = buildCast(
    board,
    resolved.knobs.density,
    resolved.knobs.texts >= 0.5,
    makeRng(seed, 'cast'),
    resolved.cast
  )
  warnings.push(...castWarnings)
  const groups = groupCast(cast)

  const safe = safeArea(resolved.width, resolved.height, resolved.title !== undefined)
  const stageAspect = safe.w / safe.h
  const stagePx = Math.min(safe.w, safe.h) * 0.5
  const steps = Math.round(durationSeconds * 15)
  /** beats → loop steps; scales with duration but lands on the same grid at 168 */
  const beat = (b: number): number => Math.round((b * steps) / ARC_BEATS)

  // board-seeded formation picks: sparse A, dense B, closing residue D
  const planRng = makeRng(seed, `plan:${board.source.boardName}`)
  const aId: FormationId = planRng.pick(['orbit', 'marks'] as const)
  const bId: FormationId = planRng.pick(['columns', 'ring'] as const)
  const aVariant = planRng.int(0, 2)
  // D is the other marks variant when A was marks, else seeded
  const dVariant = aId === 'marks' ? 1 - aVariant : planRng.int(0, 2)
  const formationIds: readonly FormationId[] = [aId, bId, 'quad', 'ghost', 'marks']
  const marksVariants: number[] = []
  if (aId === 'marks') marksVariants.push(aVariant)
  marksVariants.push(dVariant)

  const maps = buildBeatMaps(
    groups,
    resolved.knobs.density,
    (label) => makeRng(seed, `form:${label}`),
    formationIds,
    stageAspect,
    stagePx,
    marksVariants
  )

  const placements: Placement[] = []
  const bands: ArcBand[] = [ARC.A, ARC.B, ARC.C, ARC.D]
  const mapIdxFor = [0, 1, 2, 4] as const // 'ghost' (index 3) has no slot map
  for (const [fi, mi] of mapIdxFor.entries()) {
    const band = bands[fi] as ArcBand
    const map = maps.get(mi) as Map<string, Slot[]>
    // rank: normalized slot distance from centre; outs cascade in reverse
    let maxDist = 0
    for (const slots of map.values()) {
      for (const s of slots) maxDist = Math.max(maxDist, Math.hypot(s.x, s.y))
    }
    const rngP = makeRng(seed, `pat:${fi}`)
    for (const [gid, slots] of map) {
      const glyph = cast.find((g) => g.id === gid)
      if (glyph === undefined) continue
      for (const s of slots) {
        let rank = maxDist > 0 ? Math.hypot(s.x, s.y) / maxDist : 0
        if (band.cascade === 'edges-in') rank = 1 - rank
        const inStep = beat(band.inBeat + rank * band.inSpread)
        // last in, first out
        const outStep = beat(band.outBeat + (1 - rank) * band.outSpread)
        const atoms = expand(s.copies, { x: s.x, y: s.y, rot: s.rot, scale: s.scale, alpha: 1 })
        // text reads as an ornament: the true copy nearly full, reflections dim
        const tones =
          glyph.kind === 'text' ? atoms.map((_, i) => (i === 0 ? 0.9 : 0.45)) : atoms.map(() => 1)
        placements.push({
          glyphId: gid,
          atoms,
          tones,
          role: s.hero === true ? 'hero' : (KIND_ROLE[glyph.kind] as Tone),
          inStep,
          outStep: outStep % steps,
          pattern: rngP.int(0, 6),
          formation: mi
        })
      }
    }
  }

  // ghost bins decode as units — heroes first, then outward from the centre
  const geo = buildGhostGeometry(board, heroRefs, resolved.title, stageAspect)
  const rngG = makeRng(seed, 'pat:ghost')
  const ghostBand = ARC.ghost
  const maxBinDist = Math.max(1e-9, ...geo.bins.filter((b) => !b.hero).map((b) => b.dist))
  const ghost: GlyphGhost = {
    bins: geo.bins.map((b) => {
      const rank = b.hero ? 0 : b.dist / maxBinDist
      return {
        strokes: b.strokes,
        hero: b.hero,
        inStep: beat(ghostBand.inBeat + rank * ghostBand.inSpread),
        outStep: beat(ghostBand.outBeat + (1 - rank) * ghostBand.outSpread) % steps,
        pattern: rngG.int(0, 6)
      }
    }),
    label: geo.label,
    labelPos: geo.labelPos
  }

  // the seam mark: one single punct at the centre, holding across the wrap
  const rngSeam = makeRng(seed, 'pat:seam')
  const seamGlyph = groups.marks[planRng.int(0, Math.max(1, groups.marks.length))]
  if (seamGlyph !== undefined) {
    placements.push({
      glyphId: seamGlyph.id,
      atoms: [{ x: 0, y: 0, rot: 0, scale: 0.06, alpha: 1 }],
      tones: [1],
      role: 'punct',
      inStep: beat(SEAM_IN_BEAT),
      outStep: beat(SEAM_OUT_BEAT) % steps,
      pattern: rngSeam.int(0, 6),
      formation: 4 // part of the closing residue's window
    })
  }

  const formationIdsArr: FormationId[] = [aId, bId, 'quad', 'ghost', 'marks']
  const formationBands: ArcBand[] = [ARC.A, ARC.B, ARC.C, ARC.ghost, ARC.D]
  const formations: FormationEvent[] = formationIdsArr.map((id, i) => {
    const band = formationBands[i] as ArcBand
    // the window is the units' own first inStep / last outStep — the seam mark
    // wraps the loop, so only non-wrapping units feed the end
    const units = i === 3 ? ghost.bins : placements.filter((p) => p.formation === i)
    const inSteps = units.map((u) => u.inStep)
    const outEnds = units.filter((u) => u.outStep > u.inStep).map((u) => u.outStep)
    const firstIn = inSteps.length > 0 ? Math.min(...inSteps) : beat(band.inBeat)
    const lastOut = outEnds.length > 0 ? Math.max(...outEnds) : beat(band.outBeat + band.outSpread)
    return { id, startPhase: firstIn / steps, endPhase: lastOut / steps, beat: i }
  })

  // glints: every ~21 steps of a hold, one support placement dips for a step
  const glints: Array<{ placement: number; step: number }> = []
  const rngGl = makeRng(seed, 'glint')
  for (const [fi, mi] of mapIdxFor.entries()) {
    const band = bands[fi] as ArcBand
    const holdStart = beat(band.inBeat + band.inSpread) + 5
    const holdEnd = beat(band.outBeat)
    const supports = placements
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.formation === mi && p.role === 'support')
    for (let s = holdStart; s < holdEnd; s += 21) {
      const pick = supports[rngGl.int(0, supports.length)]
      if (pick === undefined) break
      glints.push({ placement: pick.i, step: s % steps })
    }
  }

  // drop cast members no placement uses — they would draw nothing anyway
  const usedIds = new Set(placements.map((p) => p.glyphId))
  const activeCast = cast.filter((g) => usedIds.has(g.id))

  return {
    cast: activeCast,
    placements,
    formations,
    steps,
    cadence: resolved.cadence,
    ghost,
    glints,
    warnings
  }
}
