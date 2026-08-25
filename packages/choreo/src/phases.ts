import type { BoardModel, Vec2 } from '@silk-reel/ingest'
import { clamp01, ease } from './curves.js'
import { makeRng, type Rng } from './rng.js'
import type { Keyframe, PhaseSpec, PhaseKind, TimelineElement, ActId } from './types.js'

export const CORE_RETAINED_FRACTION = 0.02
export const CORE_OPACITY = 0.35

export interface Member {
  id: string
  kind: string
  layer: string
  pos: Vec2
  netId?: number | undefined
}

export interface Unit {
  key: string
  members: Member[]
  pos: Vec2
  fpRef?: string | undefined
  netId?: number | undefined
  groupId: number
}

export interface SymGroup {
  units: Unit[]
  error: number
  targets: Vec2[]
}

export interface Placement {
  dx: number
  dy: number
}

export function centroid(points: Vec2[]): Vec2 {
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  const n = Math.max(1, points.length)
  return { x: sx / n, y: sy / n }
}

interface RawElement {
  id: string
  kind: string
  layer: string
  pos: Vec2
  netId?: number | undefined
  fpRef?: string | undefined
}

export function collectRawElements(board: BoardModel): RawElement[] {
  const out: RawElement[] = []
  const fpOwned = new Set<string>()
  for (const fp of board.footprints) {
    for (const ref of [...fp.padRefs, ...fp.silkRefs]) fpOwned.add(ref)
  }

  for (const o of board.outline) {
    if (fpOwned.has(o.id)) continue
    out.push({ id: o.id, kind: 'outline', layer: o.layerId, pos: centroid(o.points) })
  }
  for (const d of board.drill) {
    if (fpOwned.has(d.id)) continue
    out.push({ id: d.id, kind: 'drill', layer: 'drill', pos: d.pos })
  }
  for (const [layerId, c] of Object.entries(board.copper)) {
    for (const t of c.traces) {
      if (fpOwned.has(t.id)) continue
      out.push({ id: t.id, kind: 'trace', layer: layerId, pos: t.points[0] ?? { x: 0, y: 0 }, netId: t.netId })
    }
    for (const p of c.pads) {
      out.push({ id: p.id, kind: 'pad', layer: layerId, pos: p.pos, netId: p.netId, fpRef: p.footprintRef })
    }
    for (const v of c.vias) {
      if (fpOwned.has(v.id)) continue
      out.push({ id: v.id, kind: 'via', layer: layerId, pos: v.pos, netId: v.netId })
    }
    for (const z of c.zones) {
      if (fpOwned.has(z.id)) continue
      out.push({ id: z.id, kind: 'zone', layer: layerId, pos: centroid(z.outline), netId: z.netId })
    }
  }
  for (const [layerId, s] of Object.entries(board.silkscreen)) {
    for (const l of s.lines) {
      if (fpOwned.has(l.id)) continue
      out.push({ id: l.id, kind: 'silk-line', layer: layerId, pos: l.points[0] ?? { x: 0, y: 0 } })
    }
    for (const t of s.texts) {
      if (fpOwned.has(t.id)) continue
      out.push({ id: t.id, kind: 'text', layer: layerId, pos: t.pos, fpRef: t.footprintRef })
    }
  }

  const known = new Set(out.map((el) => el.id))
  const byId = new Map<string, RawElement>()
  for (const el of out) {
    const existing = byId.get(el.id)
    if (existing === undefined || el.fpRef !== undefined) byId.set(el.id, el)
  }
  for (const fp of board.footprints) {
    for (const ref of [...fp.padRefs, ...fp.silkRefs]) {
      if (!known.has(ref) && !byId.has(ref)) {
        byId.set(ref, { id: ref, kind: 'silk-line', layer: 'F.SilkS', pos: fp.pos, fpRef: fp.ref })
        known.add(ref)
        out.push(byId.get(ref) as RawElement)
      }
    }
  }
  return out
}

interface FpGroup {
  fpRef: string
  members: RawElement[]
  pos: Vec2
  homeAct: ActId
}

export interface ActContent {
  actId: ActId
  units: Unit[]
}

export function assignElementsToActs(
  board: BoardModel,
  order: ActId[]
): { contents: Map<ActId, Unit[]>; unassigned: RawElement[] } {
  const raw = collectRawElements(board)
  const unitOf = new Map<ActId, Unit[]>(order.map((id) => [id, []]))
  let groupId = 0

  const byId = new Map<string, RawElement>()
  for (const el of raw) {
    const existing = byId.get(el.id)
    if (existing === undefined || (el.fpRef !== undefined && existing.fpRef === undefined)) byId.set(el.id, el)
  }

  const fpMembers = new Map<string, RawElement[]>()
  for (const fp of board.footprints) {
    const members: RawElement[] = []
    for (const ref of [...fp.padRefs, ...fp.silkRefs]) {
      const el = byId.get(ref)
      if (el) members.push(el)
    }
    fpMembers.set(fp.ref, members)
  }

  const footprintGroups: FpGroup[] = []
  for (const fp of board.footprints) {
    const members = fpMembers.get(fp.ref) ?? []
    if (members.length === 0) continue
    const copperHome = `copper:${fp.layer}` as ActId
    const silkFallback = `silk:${members[0]?.layer ?? 'F.SilkS'}` as ActId
    let homeAct: ActId = order.includes(copperHome) ? copperHome : silkFallback
    if (!order.includes(homeAct)) homeAct = order[0] as ActId
    footprintGroups.push({
      fpRef: fp.ref,
      members,
      pos: fp.pos,
      homeAct
    })
  }

  for (const fg of footprintGroups.sort((a, b) => a.fpRef.localeCompare(b.fpRef))) {
    const sorted = [...fg.members].sort((a, b) => a.id.localeCompare(b.id))
    const netIds = sorted.map((m) => m.netId).filter((n): n is number => n !== undefined)
    const arr = unitOf.get(fg.homeAct)
    if (!arr) continue
    arr.push({
      key: `fp:${fg.fpRef}`,
      members: sorted,
      pos: fg.pos,
      fpRef: fg.fpRef,
      netId: netIds.length > 0 ? Math.min(...netIds) : undefined,
      groupId
    })
    groupId++
  }

  const inFootprint = new Set<string>()
  for (const fg of footprintGroups) for (const m of fg.members) inFootprint.add(m.id)

  const solos = raw
    .filter((el) => !inFootprint.has(el.id) && el.fpRef === undefined)
    .sort((a, b) => a.id.localeCompare(b.id))
  const unassigned: RawElement[] = []

  const homeOf = (el: RawElement): ActId => {
    switch (el.kind) {
      case 'trace':
      case 'pad':
      case 'via':
      case 'zone':
        return `copper:${el.layer}` as ActId
      case 'silk-line':
      case 'text':
        return `silk:${el.layer}` as ActId
      case 'outline':
        return 'outline'
      case 'drill':
        return 'drill'
      default:
        return 'outline'
    }
  }

  for (const el of solos) {
    if (inFootprint.has(el.id)) continue
    let home = homeOf(el)
    if (!unitOf.has(home)) {
      if (el.kind === 'via') {
        const alt = [...unitOf.keys()].find((k) => k.startsWith('copper:'))
        if (alt) home = alt
      } else {
        unassigned.push(el)
        continue
      }
    }
    const arr = unitOf.get(home)
    if (!arr) {
      unassigned.push(el)
      continue
    }
    arr.push({ key: el.id, members: [el], pos: el.pos, netId: el.netId, groupId })
    groupId++
  }

  return { contents: unitOf, unassigned }
}

export function pairUnits(
  units: Unit[],
  center: Vec2,
  mode: 'mirror-x' | 'mirror-y' | 'quad' | 'rotational180' | 'none'
): SymGroup[] {
  const ordered = [...units].sort((a, b) => a.key.localeCompare(b.key))

  if (mode === 'none') {
    return ordered.map((u) => ({ units: [u], error: 0, targets: [{ ...u.pos }] }))
  }

  const groups = rankPair(ordered, center, mode)
  for (const g of groups) g.targets = mirrorTargets(g.units.map((u) => u.pos), center, mode)
  return groups
}

function rankPair(ordered: Unit[], center: Vec2, mode: string): SymGroup[] {
  const groups: SymGroup[] = []
  const pool = [...ordered]

  while (pool.length > 0) {
    let seedIdx = 0
    let seedDist = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const u = pool[i] as Unit
      const d = Math.hypot(u.pos.x - center.x, u.pos.y - center.y)
      if (d > seedDist) {
        seedDist = d
        seedIdx = i
      }
    }
    const seed = pool.splice(seedIdx, 1)[0] as Unit
    const units: Unit[] = [seed]
    let err = 0

    if (mode === 'rotational180' || mode === 'quad') {
      const partner = extractBest(pool, (b) =>
        Math.hypot(seed.pos.x + b.pos.x - 2 * center.x, seed.pos.y + b.pos.y - 2 * center.y)
      )
      if (partner) {
        err += partner.err
        units.push(partner.unit)
      }
    }
    if (mode === 'mirror-x' || mode === 'quad') {
      const anchor = units[units.length - 1] as Unit
      const partner = extractBest(pool, (b) =>
        Math.abs(anchor.pos.x + b.pos.x - 2 * center.x) + 0.5 * Math.abs(b.pos.y - anchor.pos.y)
      )
      if (partner) {
        err += partner.err
        units.push(partner.unit)
      }
    }
    if (mode === 'mirror-y' || mode === 'quad') {
      const anchor = units[units.length - 1] as Unit
      const partner = extractBest(pool, (b) =>
        Math.abs(anchor.pos.y + b.pos.y - 2 * center.y) + 0.5 * Math.abs(b.pos.x - anchor.pos.x)
      )
      if (partner) {
        err += partner.err
        units.push(partner.unit)
      }
    }

    groups.push({ units: units.sort((a, b) => a.key.localeCompare(b.key)), error: err, targets: [] })
  }
  return groups
}

function extractBest(pool: Unit[], costOf: (u: Unit) => number): { unit: Unit; err: number } | undefined {
  if (pool.length === 0) return undefined
  let bestIdx = 0
  let bestErr = Infinity
  for (let i = 0; i < pool.length; i++) {
    const e = costOf(pool[i] as Unit)
    if (e < bestErr) {
      bestErr = e
      bestIdx = i
    }
  }
  return { unit: pool.splice(bestIdx, 1)[0] as Unit, err: bestErr }
}

function mirrorTargets(positions: Vec2[], center: Vec2, mode: string): Vec2[] {
  const n = positions.length
  if (n === 1) return [{ ...(positions[0] as Vec2) }]
  const out: Vec2[] = new Array<Vec2>(n)

  if (mode === 'mirror-x' || mode === 'mirror-y') {
    const axis = mode === 'mirror-x' ? 'x' : 'y'
    const other = mode === 'mirror-x' ? 'y' : 'x'
    const idx = [...positions.keys()].sort((i, j) => (positions[i] as Vec2)[axis] - (positions[j] as Vec2)[axis])
    for (let k = 0; k < n; k++) {
      const lo = idx[k] as number
      const hi = idx[n - 1 - k] as number
      if (lo === hi) {
        out[lo] = { ...(positions[lo] as Vec2) }
        continue
      }
      if (out[lo]) continue
      const dHalf = ((positions[hi] as Vec2)[axis] - (positions[lo] as Vec2)[axis]) / 2
      const qLo: Vec2 = { ...(positions[lo] as Vec2) }
      const qHi: Vec2 = { ...(positions[hi] as Vec2) }
      qLo[axis] = center[axis] - dHalf
      qHi[axis] = center[axis] + dHalf
      void other
      out[lo] = qLo
      out[hi] = qHi
    }
    return out
  }

  if (n === 2 || n === 3) {
    const p0 = positions[0] as Vec2
    const p1 = positions[1] as Vec2
    const half = { x: (p0.x - p1.x) / 2, y: (p0.y - p1.y) / 2 }
    out[0] = { x: center.x + half.x, y: center.y + half.y }
    out[1] = { x: center.x - half.x, y: center.y - half.y }
    if (n === 3) out[2] = { ...(positions[2] as Vec2) }
    return out
  }

  const mean = centroid(positions)
  const quadrants: Array<{ idx: number; qx: number; qy: number }> = positions.map((p, idx) => ({
    idx,
    qx: Math.sign(p.x - mean.x),
    qy: Math.sign(p.y - mean.y)
  }))
  const dxHalf = Math.max(...positions.map((p) => Math.abs(p.x - mean.x)))
  const dyHalf = Math.max(...positions.map((p) => Math.abs(p.y - mean.y)))
  const used = new Set<number>()
  const pickCorner = (qx: number, qy: number): number => {
    let bestIdx = -1
    let bestScore = -Infinity
    for (const q of quadrants) {
      if (used.has(q.idx)) continue
      const score = qx * (positions[q.idx] as Vec2).x + qy * (positions[q.idx] as Vec2).y
      if (score > bestScore) {
        bestScore = score
        bestIdx = q.idx
      }
    }
    used.add(bestIdx)
    return bestIdx
  }
  for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const idx = pickCorner(qx, qy)
    if (idx < 0) continue
    out[idx] = { x: center.x + qx * dxHalf, y: center.y + qy * dyHalf }
  }
  for (let i = 0; i < n; i++) if (!out[i]) out[i] = { ...(positions[i] as Vec2) }
  return out
}

export function pairPlacement(group: SymGroup): Placement[] {
  return group.units.map((unit, i) => {
    const target = group.targets[i]
    return target ? { dx: r4(target.x - unit.pos.x), dy: r4(target.y - unit.pos.y) } : { dx: 0, dy: 0 }
  })
}

const MIN_PHASE_FRAMES = { seed: 2, populate: 3, build: 3, sustain: 2, dissolve: 2 } as const

const DISSOLVE_TAIL_SECONDS = 2.5

function sumMins(): number {
  return (
    MIN_PHASE_FRAMES.seed +
    MIN_PHASE_FRAMES.populate +
    MIN_PHASE_FRAMES.build +
    MIN_PHASE_FRAMES.sustain +
    MIN_PHASE_FRAMES.dissolve
  )
}


export interface SplitPhasesResult {
  phases: PhaseSpec[]
  seed: PhaseSpec
  populate: PhaseSpec
  beat: PhaseSpec | undefined
  build: PhaseSpec
  sustain: PhaseSpec
  dissolve: PhaseSpec
}

const MIN_ACT_FRAMES_WITH_BEAT = 12

export function splitActPhases(
  start: number,
  end: number,
  fps: number,
  withBeat: boolean,
  reserveTail = false
): SplitPhasesResult {
  const len = end - start + 1
  const minSum = sumMins()

  let carryBeat = withBeat && len >= MIN_ACT_FRAMES_WITH_BEAT
  if (withBeat && !carryBeat) {
    const beatLenOnly = Math.max(2, Math.round(0.4 * fps))
    if (len - beatLenOnly >= minSum) carryBeat = true
  }
  return layout(start, end, fps, carryBeat, reserveTail)
}

function layout(
  start: number,
  end: number,
  fps: number,
  withBeatRequested: boolean,
  reserveTail: boolean
): SplitPhasesResult {
  const len = end - start + 1
  const minSum = sumMins()

  let withBeatFinal = withBeatRequested && len >= MIN_ACT_FRAMES_WITH_BEAT + Math.max(2, Math.round(0.4 * fps))
  if (withBeatRequested && !withBeatFinal) {
    const beatLenOnly = Math.max(2, Math.round(0.4 * fps))
    if (len - beatLenOnly >= minSum) withBeatFinal = true
  }
  const beatLen = withBeatFinal ? Math.max(2, Math.round(0.4 * fps)) : 0

  const headMins = [MIN_PHASE_FRAMES.seed, MIN_PHASE_FRAMES.populate, MIN_PHASE_FRAMES.build, MIN_PHASE_FRAMES.sustain]
  const headMinSum = headMins.reduce((a, b) => a + b, 0)
  const canReserve =
    reserveTail && len - beatLen - headMinSum >= MIN_PHASE_FRAMES.dissolve
  const mins = canReserve
    ? headMins
    : [...headMins, MIN_PHASE_FRAMES.dissolve]
  const weights = withBeatFinal
    ? canReserve
      ? ([0.13, 0.27, 0.24, 0.2] as const)
      : ([0.13, 0.27, 0.24, 0.2, 0.16] as const)
    : canReserve
      ? ([0.15, 0.34, 0.23, 0.15] as const)
      : ([0.15, 0.34, 0.23, 0.15, 0.13] as const)

  const desiredTail = canReserve
    ? Math.max(
        MIN_PHASE_FRAMES.dissolve,
        Math.min(Math.round(fps * DISSOLVE_TAIL_SECONDS), len - beatLen - headMinSum)
      )
    : 0
  const flex = len - beatLen - desiredTail

  let allocs: number[]
  if (flex >= mins.reduce((a, b) => a + b, 0)) {
    allocs = weights.map((w, i) => Math.max(mins[i] as number, Math.round(flex * w)))
    let allocSum = allocs.reduce((a, b) => a + b, 0)
    if (allocSum > flex) {
      allocs = allocs.map((a, i) => Math.max(mins[i] as number, Math.floor(a * (flex / allocSum))))
      allocSum = allocs.reduce((a, b) => a + b, 0)
    }
    let guard = 0
    while (allocSum < flex && guard < 10000) {
      const i = guard % allocs.length
      allocs[i] = (allocs[i] as number) + 1
      allocSum += 1
      guard += 1
    }
    guard = 0
    while (allocSum > flex && guard < 10000) {
      const orderIdx = canReserve ? [1, 3, 2, 0] : [1, 3, 2, 4, 0]
      for (const i of orderIdx) {
        if (allocSum <= flex) break
        const cur = allocs[i] as number
        const min = mins[i] as number
        if (cur > min) {
          allocs[i] = cur - 1
          allocSum -= 1
        }
      }
      guard += 1
    }
  } else {
    const base = Math.floor(flex / mins.length)
    const extra = flex - base * mins.length
    allocs = mins.map((_, i) => base + (i < extra ? 1 : 0))
  }
  if (canReserve) {
    allocs.push(len - beatLen - allocs.reduce((a, b) => a + b, 0))
  }

  const specs: PhaseSpec[] = []
  const kinds: string[] = withBeatFinal
    ? ['seed', 'populate', 'beat', 'build', 'sustain', 'dissolve']
    : ['seed', 'populate', 'build', 'sustain', 'dissolve']
  let cursor = start
  let allocIdx = 0
  for (const kind of kinds) {
    if (cursor > end) break
    const alloc = kind === 'beat' ? beatLen : allocs[allocIdx]
    if (kind !== 'beat') allocIdx += 1
    const size = Math.max(1, alloc ?? 1)
    const clampedSize = Math.min(size, end - cursor + 1)
    if (clampedSize <= 0) break
    specs.push({ kind: kind as PhaseKind, startFrame: cursor, endFrame: cursor + clampedSize - 1 })
    cursor += clampedSize
  }
  for (const mandatory of ['seed', 'populate', 'build', 'sustain', 'dissolve'] as const) {
    if (!specs.some((p) => p.kind === mandatory)) {
      specs.push({ kind: mandatory, startFrame: end, endFrame: end })
    }
  }
  specs.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame)

  const find = (k: string): PhaseSpec => {
    const s = specs.find((p) => p.kind === k)
    if (!s) throw new Error(`phase ${k} missing`)
    return s
  }
  return {
    phases: specs,
    seed: find('seed'),
    populate: find('populate'),
    beat: specs.find((p) => p.kind === 'beat'),
    build: find('build'),
    sustain: find('sustain'),
    dissolve: find('dissolve')
  }
}

export interface ScheduleInput {
  groups: SymGroup[]
  split: SplitPhasesResult
  rngInt: (minInclusive: number, maxExclusive: number) => number
  shuffle: <T,>(items: T[]) => T[]
  center: Vec2
  seedPairs: number
  rhythmDensity: number
  beatIntensity: number
  flicker: number
  dissolveStyle: 'center-out' | 'fade' | 'wipe' | 'scatter'
  easing: 'expo-out' | 'back-out' | 'linear' | 'sine'
  isFinalAct: boolean
  totalFrames: number
  carriesBeat: boolean
  coreRng?: Rng | undefined
}

export interface UnitSchedule {
  unit: Unit
  keyframes: Keyframe[]
  isCore: boolean
  placement: Placement
}

export interface ScheduleResult {
  schedules: UnitSchedule[]
  beatFrame?: number | undefined
}

interface GroupPlan {
  group: SymGroup
  appearStart: number
  rampFrames: number
  isSliver: boolean
  isCore: boolean
  rebuildStart?: number
  rebuildRamp?: number
  flickerDips: Array<{ frame: number; depth: number }>
  placements: Placement[]
  core?: boolean | undefined
}

export function scheduleAct(input: ScheduleInput): ScheduleResult {
  const { groups, split, center } = input
  const plans: GroupPlan[] = groups.map((group) => ({
    group,
    appearStart: split.populate.startFrame,
    rampFrames: 2,
    isSliver: false,
    isCore: false,
    flickerDips: [],
    placements: pairPlacement(group)
  }))

  const repPos = (g: GroupPlan): Vec2 => (g.group.units[0] as Unit).pos
  const dist = (g: GroupPlan): number => Math.hypot(repPos(g).x - center.x, repPos(g).y - center.y)
  const groupNet = (g: GroupPlan): number | undefined => {
    let min: number | undefined
    for (const u of g.group.units) {
      for (const m of u.members) {
        if (m.netId !== undefined && (min === undefined || m.netId < min)) min = m.netId
      }
    }
    return min
  }

  const ordered = [...plans].sort((a, b) => {
    const na = groupNet(a)
    const nb = groupNet(b)
    if (na !== nb) return (na ?? Number.MAX_SAFE_INTEGER) - (nb ?? Number.MAX_SAFE_INTEGER)
    const da = dist(a)
    const dbv = dist(b)
    if (da !== dbv) return da - dbv
    return (a.group.units[0]?.key ?? '').localeCompare(b.group.units[0]?.key ?? '')
  })

  const eligible = plans
  const seedChoices = input.shuffle([...eligible]).slice(0, Math.min(input.seedPairs, eligible.length))
  const seedSet = new Set<GroupPlan>(seedChoices)

  const popLen = split.populate.endFrame - split.populate.startFrame + 1
  const spanP = Math.max(2, Math.round(popLen * (1 - 0.75 * input.rhythmDensity)))
  const jitterAmp = Math.max(0, Math.round((popLen - spanP) * 0.35 * (1 - input.rhythmDensity)))

  const arrivalPlans = ordered.filter((p) => !seedSet.has(p))
  const n = Math.max(1, arrivalPlans.length)
  arrivalPlans.forEach((plan, i) => {
    const frac = i / n
    let arrival = split.populate.startFrame + frac * spanP
    if (jitterAmp > 0) arrival += input.rngInt(0, jitterAmp + 1)
    arrival = Math.min(arrival, split.populate.endFrame - 0.5)
    plan.appearStart = Math.max(split.seed.startFrame, arrival)
    plan.rampFrames = Math.max(1, Math.min(4, popLen * 0.06))
  })

  const seedList = [...seedSet]
  seedList.forEach((plan, i) => {
    const slotN = Math.max(1, seedList.length)
    const slot = (split.seed.endFrame - split.seed.startFrame + 1) / slotN
    plan.appearStart = split.seed.startFrame + i * slot
    plan.rampFrames = Math.max(1, slot * 0.7)
  })

  let beatFrame: number | undefined
  if (input.carriesBeat && split.beat) {
    const beatStart = split.beat.startFrame
    beatFrame = beatStart
    const visible = ordered.filter((p) => p.appearStart + p.rampFrames <= beatStart)
    const sliverCount = Math.max(1, Math.round(visible.length * (0.01 + 0.06 * input.beatIntensity)))
    const bySymmetryError = [...visible].sort((a, b) => {
      if (b.group.units.length !== a.group.units.length) return b.group.units.length - a.group.units.length
      if (a.group.error !== b.group.error) return a.group.error - b.group.error
      return dist(a) - dist(b)
    })
    for (const plan of bySymmetryError.slice(0, sliverCount)) plan.isSliver = true

    const buildLen = split.build.endFrame - split.build.startFrame + 1
    const rebuildRamp = Math.max(2, Math.min(Math.round(buildLen * 0.45), 8))
    const rebuildable = [...ordered].sort((a, b) => dist(a) - dist(b))
    rebuildable.forEach((plan, i) => {
      const n = Math.max(1, rebuildable.length - 1)
      const frac = rebuildable.length === 1 ? 0 : i / n
      plan.rebuildStart = split.build.startFrame + frac * Math.max(0, buildLen - rebuildRamp)
      plan.rebuildRamp = rebuildRamp
    })
  }

  const susLen = split.sustain.endFrame - split.sustain.startFrame + 1
  if (input.flicker > 0 && susLen >= 6) {
    const dipCount = 1 + Math.round(input.flicker * 3)
    for (const plan of plans) {
      for (let k = 0; k < dipCount; k++) {
        const frame = split.sustain.startFrame + 2 + input.rngInt(0, Math.max(1, susLen - 4))
        plan.flickerDips.push({ frame, depth: 1 - input.flicker * (0.5 + 0.4 * ((frame * 7919) % 100) / 100) })
      }
    }
  }

  if (input.isFinalAct) {
    const coreUnits = selectCore(plans, center, input.coreRng ?? makeRng(0, 'core:fallback'))
    for (const plan of plans) plan.core = plan.group.units.some((u) => coreUnits.has(u))
  }

  const allUnits = plans.flatMap((p) => p.group.units)
  const maxDist = Math.max(...allUnits.map((u) => Math.hypot(u.pos.x - center.x, u.pos.y - center.y)), 1)
  const xs = allUnits.map((u) => u.pos.x)
  const minX = Math.min(...xs)
  const spanX = Math.max(Math.max(...xs) - minX, 1e-6)

  const schedules: UnitSchedule[] = []
  for (const plan of plans) {
    const planIsCore = plan.core === true
    for (const [unitIdx, unit] of plan.group.units.entries()) {
      const placement = plan.placements[unitIdx] ?? { dx: 0, dy: 0 }
      const exit = unitExitTiming(
        planIsCore,
        unit.pos,
        split,
        input,
        maxDist,
        minX,
        spanX
      )
      schedules.push({
        unit,
        keyframes: buildUnitKeyframes(plan, placement, exit, split, input, beatFrame),
        isCore: planIsCore,
        placement
      })
    }
  }

  return { schedules, beatFrame }
}

export interface UnitExitTiming {
  isCore: boolean
  exitStart: number
  exitRamp: number
}

function unitExitTiming(
  isCore: boolean,
  unitPos: Vec2,
  split: SplitPhasesResult,
  input: ScheduleInput,
  maxDist: number,
  minX: number,
  spanX: number
): UnitExitTiming {
  if (isCore) return { isCore: true, exitStart: split.dissolve.startFrame, exitRamp: 2 }
  const disLen = split.dissolve.endFrame - split.dissolve.startFrame + 1
  const exitRamp = Math.max(1.5, Math.min(4, disLen * 0.25))
  const spanFrames = Math.max(0, disLen - exitRamp)
  switch (input.dissolveStyle) {
    case 'fade':
      return { isCore: false, exitStart: split.dissolve.startFrame, exitRamp: Math.max(1.5, disLen - 1) }
    case 'center-out': {
      const d = Math.hypot(unitPos.x - input.center.x, unitPos.y - input.center.y)
      return { isCore: false, exitStart: split.dissolve.startFrame + (1 - d / maxDist) * spanFrames, exitRamp }
    }
    case 'wipe':
      return {
        isCore: false,
        exitStart: split.dissolve.startFrame + ((unitPos.x - minX) / spanX) * spanFrames,
        exitRamp
      }
    case 'scatter':
      return {
        isCore: false,
        exitStart: split.dissolve.startFrame + input.rngInt(0, Math.max(1, disLen - Math.ceil(exitRamp))),
        exitRamp
      }
    default: {
      const never: never = input.dissolveStyle
      throw new Error(`unknown dissolve style ${String(never)}`)
    }
  }
}

function selectCore(plans: GroupPlan[], center: Vec2, rng: Rng): Set<Unit> {
  const core = new Set<Unit>()
  const scored = plans.flatMap((p) =>
    p.group.units.map((u) => ({
      unit: u,
      members: u.members.length,
      d: Math.hypot(u.pos.x - center.x, u.pos.y - center.y)
    }))
  )
  if (scored.length === 0) return core
  const totalMembers = scored.reduce((s, e) => s + e.members, 0)
  const targetMembers = Math.max(2, Math.round(totalMembers * CORE_RETAINED_FRACTION))
  const ordered = centerWeightedOrder(scored, rng)
  let cumulative = 0
  let cap = Number.POSITIVE_INFINITY
  for (const entry of ordered) {
    if (core.size > 0 && cumulative + entry.members > cap) break
    core.add(entry.unit)
    cumulative += entry.members
    if (core.size === 1) cap = Math.max(targetMembers, entry.members)
  }
  return core
}

interface CoreCandidate {
  unit: Unit
  members: number
  d: number
}

function centerWeightedOrder(entries: CoreCandidate[], rng: Rng): CoreCandidate[] {
  const pool = [...entries]
  const out: CoreCandidate[] = []
  while (pool.length > 0) {
    let total = 0
    const weights = new Array<number>(pool.length)
    for (let i = 0; i < pool.length; i++) {
      const w = Math.max((pool[i] as CoreCandidate).d, 0.001) ** 2
      weights[i] = w
      total += w
    }
    let r = rng.next() * total
    let idx = pool.length - 1
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i] as number
      if (r <= 0) {
        idx = i
        break
      }
    }
    out.push(pool.splice(idx, 1)[0] as CoreCandidate)
  }
  return out
}

function buildUnitKeyframes(
  plan: GroupPlan,
  placement: Placement,
  exit: UnitExitTiming,
  split: SplitPhasesResult,
  input: ScheduleInput,
  beatFrame: number | undefined
): Keyframe[] {
  const byFrame = new Map<number, Keyframe>()
  const put = (frame: number, opacity: number, scaleX: number, scaleY: number, glowMul: number): void => {
    const f = Math.max(0, Math.round(frame))
    const existing = byFrame.get(f)
    if (existing) {
      existing.opacity = r4(opacity)
      existing.scaleX = r4(scaleX)
      existing.scaleY = r4(scaleY)
      existing.glow = r4(glowMul)
      return
    }
    byFrame.set(f, { frame: f, opacity: r4(opacity), scaleX: r4(scaleX), scaleY: r4(scaleY), glow: r4(glowMul) })
  }

  put(plan.appearStart, 0.001, 0.25, 0.25, 1)
  const fullAt = plan.appearStart + plan.rampFrames
  put(fullAt, 1, 1, 1, 1)

  if (beatFrame !== undefined && split.beat) {
    const sliverOp = Math.min(1, 0.08 + 0.85 * input.beatIntensity)
    const atBeat = plan.isSliver ? sliverOp : 0
    if (Math.round(fullAt) < beatFrame - 1) {
      put(beatFrame - 1, 1, 1, 1, 1)
    } else {
      put(Math.max(plan.appearStart + 1, beatFrame - 1), Math.min(1, Math.max(0.001, (beatFrame - 1 - plan.appearStart) / Math.max(0.5, plan.rampFrames))), 1, 1, 1)
    }
    put(beatFrame, atBeat, plan.isSliver ? 1 : 0.35, plan.isSliver ? 1 : 0.35, plan.isSliver ? 1.5 : 0.5)
    const rs = Math.max(beatFrame + 1, Math.ceil(plan.rebuildStart ?? split.build.startFrame))
    const rr = plan.rebuildRamp ?? 3
    put(rs, atBeat, plan.isSliver ? 1 : 0.4, plan.isSliver ? 1 : 0.4, 1)
    put(rs + rr, 1, 1, 1, 1)
  }

  for (const dip of plan.flickerDips) {
    put(dip.frame, dip.depth, 1, 1, 1)
    put(dip.frame + 1, 1, 1, 1, 1)
  }

  if (exit.isCore && input.isFinalAct) {
    put(split.dissolve.startFrame, 1, 1, 1, 1)
    put(input.totalFrames - 1, CORE_OPACITY, 1, 1, 1.3)
  } else {
    const es = Math.max(plan.appearStart + plan.rampFrames, exit.exitStart)
    put(es, 1, 1, 1, 1)
    put(es + exit.exitRamp, 0.001, 0.8, 0.8, 0.2)
    const last = input.totalFrames - 1
    put(Math.max(es + exit.exitRamp, last), 0.001, 0.8, 0.8, 0.2)
  }

  const snapStart = Math.min(Math.max(Math.ceil(fullAt), split.build.startFrame), split.build.endFrame)
  const snapLen = Math.max(1, split.build.endFrame - split.build.startFrame)
  const frames = [...byFrame.values()].sort((a, b) => a.frame - b.frame)

  let mirrorAppliedAtBeat = false
  if (beatFrame !== undefined && plan.isSliver && (placement.dx !== 0 || placement.dy !== 0)) {
    const beatKf = byFrame.get(beatFrame)
    if (beatKf) {
      beatKf.dx = placement.dx
      beatKf.dy = placement.dy
      for (const kf of frames) {
        if (kf.frame > beatFrame) break
        if (kf.dx !== undefined || kf.dy !== undefined) continue
        kf.dx = r4(placement.dx * clamp01(kf.frame / Math.max(1, beatFrame)))
        kf.dy = r4(placement.dy * clamp01(kf.frame / Math.max(1, beatFrame)))
      }
      mirrorAppliedAtBeat = true
    }
  }

  return frames.map((kf) => {
    if (placement.dx === 0 && placement.dy === 0) return kf
    if (kf.frame < snapStart && !mirrorAppliedAtBeat) return kf
    if (mirrorAppliedAtBeat && beatFrame !== undefined && kf.frame <= beatFrame) return kf
    const t = clamp01((kf.frame - snapStart) / snapLen)
    const eased = ease(t, input.easing)
    const dx = r4(placement.dx * eased)
    const dy = r4(placement.dy * eased)
    if (dx === 0 && dy === 0) return kf
    return { ...kf, dx, dy }
  })
}

export function r4(v: number): number {
  return Math.round(v * 10000) / 10000
}

export function schedulesToElements(schedules: UnitSchedule[], actId: ActId): TimelineElement[] {
  const elements: TimelineElement[] = []
  for (const s of schedules) {
    for (const member of s.unit.members) {
      elements.push({
        id: member.id,
        kind: member.kind,
        layer: member.layer,
        geomRef: member.id,
        actId,
        keyframes: s.keyframes.map((k) => ({ ...k })),
        placement: { ...s.placement }
      })
    }
  }
  return elements
}
