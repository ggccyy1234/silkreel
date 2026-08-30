import type { BBox, BoardModel, Vec2 } from '@silk-reel/ingest'
import type { ResolvedConfig } from './config'
import { makeRng } from './rng'
import type {
  ActId,
  CastRole,
  CastUnit,
  CopyTopology,
  CopyTransform,
  DirectedKeyframe,
  FilmShot,
  ShotId,
  UnitTrack
} from './types'
export { sampleDirectedKeyframes } from './sample-directed'

interface InventoryItem {
  id: string
  kind: string
  layer: string
  center: Vec2
  bounds: BBox
  footprintRef?: string | undefined
  value?: string | undefined
  netId?: number | undefined
  length?: number | undefined
  pointCount?: number | undefined
}

interface FootprintCastCandidate {
  ref: string
  value: string
  sourceAct: ActId
  members: InventoryItem[]
  bounds: BBox
  padCount: number
  silkCount: number
  score: number
}

interface CastBuildResult {
  cast: CastUnit[]
  warnings: Array<{ code: string; message: string }>
}

const SHOT_IDS: readonly ShotId[] = [
  'black-breath',
  'vertical-seed',
  'cross-collapse',
  'radial-gate',
  'bilateral-tower',
  'corner-bridge',
  'horizontal-study',
  'pad-coda',
  'black-cut'
]

const REFERENCE_BOUNDARIES = [0, 5, 35, 55, 70, 105, 120, 155, 166, 167] as const
const MAX_ASSEMBLY_UNITS = 24
const MAX_HERO_UNITS = 3
const MAX_ASSEMBLY_MEMBERS = 160
const PREFERRED_ANCHOR_REFS = ['P1', 'P2', 'P3', 'P4'] as const

const COPY_TRANSFORMS: Record<CopyTopology['mode'], CopyTransform[]> = {
  none: [{ x: 1, y: 1 }],
  'mirror-x': [{ x: 1, y: 1 }, { x: -1, y: 1 }],
  'mirror-y': [{ x: 1, y: 1 }, { x: 1, y: -1 }],
  rotational180: [{ x: 1, y: 1 }, { x: -1, y: -1 }],
  quad: [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]
}

const STAGE_CENTER = { x: 0.5, y: 0.5 }

const TOWER_HALF_SLOTS: readonly Vec2[] = [
  point(0.35, 0.27),
  point(0.44, 0.27),
  point(0.39, 0.34),
  point(0.46, 0.39),
  point(0.35, 0.45),
  point(0.44, 0.50),
  point(0.35, 0.55),
  point(0.46, 0.61),
  point(0.39, 0.66),
  point(0.44, 0.73)
]

const TOWER_FULL_SLOTS: readonly Vec2[] = [
  point(0.35, 0.27),
  point(0.65, 0.27),
  point(0.44, 0.27),
  point(0.56, 0.27),
  point(0.39, 0.34),
  point(0.61, 0.34),
  point(0.46, 0.39),
  point(0.54, 0.39),
  point(0.35, 0.45),
  point(0.65, 0.45),
  point(0.44, 0.50),
  point(0.56, 0.50),
  point(0.35, 0.55),
  point(0.65, 0.55),
  point(0.46, 0.61),
  point(0.54, 0.61),
  point(0.39, 0.66),
  point(0.61, 0.66),
  point(0.44, 0.73),
  point(0.56, 0.73)
]

const SHOT_SLOTS: Partial<Record<ShotId, readonly Vec2[]>> = {
  'vertical-seed': [
    point(0.39, 0.29),
    point(0.57, 0.34),
    point(0.43, 0.39),
    point(0.61, 0.44),
    point(0.40, 0.49),
    point(0.58, 0.53),
    point(0.42, 0.58),
    point(0.62, 0.63),
    point(0.39, 0.68),
    point(0.56, 0.73),
    point(0.45, 0.77),
    point(0.60, 0.80)
  ],
  'cross-collapse': [
    point(0.30, 0.49),
    point(0.39, 0.45),
    point(0.47, 0.53),
    point(0.55, 0.47),
    point(0.63, 0.55),
    point(0.70, 0.51),
    point(0.50, 0.36),
    point(0.50, 0.64)
  ],
  'radial-gate': [
    point(0.34, 0.35),
    point(0.66, 0.35),
    point(0.38, 0.47),
    point(0.62, 0.47),
    point(0.38, 0.53),
    point(0.62, 0.53),
    point(0.34, 0.65),
    point(0.66, 0.65)
  ],
  'bilateral-tower': [
    point(0.36, 0.27),
    point(0.43, 0.27),
    point(0.39, 0.36),
    point(0.45, 0.36),
    point(0.39, 0.45),
    point(0.45, 0.55),
    point(0.39, 0.64),
    point(0.45, 0.64),
    point(0.36, 0.73),
    point(0.43, 0.73)
  ],
  'corner-bridge': [
    point(0.34, 0.34),
    point(0.66, 0.34),
    point(0.34, 0.66),
    point(0.66, 0.66),
    point(0.40, 0.47),
    point(0.60, 0.53),
    point(0.47, 0.50),
    point(0.53, 0.50)
  ],
  'horizontal-study': [
    point(0.34, 0.36),
    point(0.43, 0.39),
    point(0.52, 0.36),
    point(0.61, 0.39),
    point(0.67, 0.45),
    point(0.32, 0.46),
    point(0.40, 0.48),
    point(0.49, 0.45),
    point(0.59, 0.48),
    point(0.66, 0.46),
    point(0.33, 0.54),
    point(0.42, 0.53),
    point(0.51, 0.55),
    point(0.61, 0.52),
    point(0.67, 0.56),
    point(0.32, 0.61),
    point(0.40, 0.60),
    point(0.49, 0.62),
    point(0.59, 0.59),
    point(0.66, 0.63)
  ],
  'pad-coda': [
    point(0.36, 0.42),
    point(0.64, 0.42),
    point(0.36, 0.58),
    point(0.64, 0.58)
  ]
}

function point(x: number, y: number): Vec2 {
  return { x, y }
}

function box(x0: number, y0: number, x1: number, y1: number): BBox {
  return { min: point(Math.min(x0, x1), Math.min(y0, y1)), max: point(Math.max(x0, x1), Math.max(y0, y1)) }
}

function union(a: BBox | undefined, b: BBox): BBox {
  if (a === undefined) return { min: { ...b.min }, max: { ...b.max } }
  return box(
    Math.min(a.min.x, b.min.x),
    Math.min(a.min.y, b.min.y),
    Math.max(a.max.x, b.max.x),
    Math.max(a.max.y, b.max.y)
  )
}

function pointsBox(points: Vec2[], padding: number): BBox | undefined {
  if (points.length === 0) return undefined
  let result: BBox | undefined
  for (const p of points) result = union(result, box(p.x - padding, p.y - padding, p.x + padding, p.y + padding))
  return result
}

function centerOf(bounds: BBox): Vec2 {
  return point((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2)
}

function dimensions(bounds: BBox): { width: number; height: number; area: number; diagonal: number } {
  const width = Math.max(0, bounds.max.x - bounds.min.x)
  const height = Math.max(0, bounds.max.y - bounds.min.y)
  return { width, height, area: width * height, diagonal: Math.hypot(width, height) }
}

function register(map: Map<string, InventoryItem>, item: InventoryItem): void {
  if (!map.has(item.id)) map.set(item.id, item)
}

function inventory(board: BoardModel): Map<string, InventoryItem> {
  const map = new Map<string, InventoryItem>()
  for (const [layer, copper] of Object.entries(board.copper)) {
    for (const trace of copper.traces) {
      const bounds = pointsBox(trace.points, Math.max(trace.width / 2, 0.1))
      if (!bounds) continue
      let length = 0
      for (let i = 1; i < trace.points.length; i++) {
        const previous = trace.points[i - 1]
        const current = trace.points[i]
        if (previous && current) length += Math.hypot(current.x - previous.x, current.y - previous.y)
      }
      register(map, { id: trace.id, kind: 'trace', layer, center: centerOf(bounds), bounds, netId: trace.netId, length, pointCount: trace.points.length })
    }
    for (const pad of copper.pads) {
      const radius = Math.max(pad.size.x, pad.size.y, 0.3) / 2
      register(map, {
        id: pad.id,
        kind: 'pad',
        layer,
        center: { ...pad.pos },
        bounds: box(pad.pos.x - radius, pad.pos.y - radius, pad.pos.x + radius, pad.pos.y + radius),
        footprintRef: pad.footprintRef,
        value: pad.shape
      })
    }
    for (const via of copper.vias) {
      const radius = Math.max(via.dia, 0.3) / 2
      register(map, {
        id: via.id,
        kind: 'via',
        layer,
        center: { ...via.pos },
        bounds: box(via.pos.x - radius, via.pos.y - radius, via.pos.x + radius, via.pos.y + radius)
      })
    }
    for (const zone of copper.zones) {
      const bounds = pointsBox(zone.outline, 0)
      if (!bounds) continue
      register(map, { id: zone.id, kind: 'zone', layer, center: centerOf(bounds), bounds })
    }
  }
  for (const [layer, silk] of Object.entries(board.silkscreen)) {
    for (const line of silk.lines) {
      const bounds = pointsBox(line.points, Math.max(line.width / 2, 0.08))
      if (!bounds) continue
      let length = 0
      for (let i = 1; i < line.points.length; i++) {
        const previous = line.points[i - 1]
        const current = line.points[i]
        if (previous && current) length += Math.hypot(current.x - previous.x, current.y - previous.y)
      }
      register(map, { id: line.id, kind: 'silk-line', layer, center: centerOf(bounds), bounds, footprintRef: undefined, length, pointCount: line.points.length })
    }
    for (const arc of silk.arcs) {
      const padding = Math.max(arc.width / 2, 0.08)
      const bounds = box(arc.center.x - arc.radius - padding, arc.center.y - arc.radius - padding, arc.center.x + arc.radius + padding, arc.center.y + arc.radius + padding)
      register(map, { id: arc.id, kind: 'arc', layer, center: { ...arc.center }, bounds, footprintRef: undefined, length: Math.abs(arc.endAngle - arc.startAngle) * arc.radius, pointCount: 2 })
    }
    for (const text of silk.texts) {
      const width = Math.max(text.value.length * text.height * 0.35, text.height * 0.6)
      const bounds = box(text.pos.x - width / 2, text.pos.y - text.height / 2, text.pos.x + width / 2, text.pos.y + text.height / 2)
      register(map, { id: text.id, kind: 'text', layer, center: { ...text.pos }, bounds, footprintRef: text.footprintRef, value: text.value })
    }
  }
  for (const path of board.outline) {
    const bounds = pointsBox(path.points, 0.08)
    if (bounds) register(map, { id: path.id, kind: 'outline', layer: path.layerId, center: centerOf(bounds), bounds })
  }
  for (const drill of board.drill) {
    const radius = Math.max(drill.dia, 0.3) / 2
    register(map, { id: drill.id, kind: 'drill', layer: 'drill', center: { ...drill.pos }, bounds: box(drill.pos.x - radius, drill.pos.y - radius, drill.pos.x + radius, drill.pos.y + radius) })
  }
  return map
}

function actForFootprint(board: BoardModel, layer: string, member: InventoryItem | undefined): ActId {
  if (Object.prototype.hasOwnProperty.call(board.copper, layer)) return `copper:${layer}`
  return `silk:${member?.layer ?? 'F.SilkS'}`
}

function candidateScore(candidate: Omit<FootprintCastCandidate, 'score'>, rank: number, tie: number): number {
  const size = dimensions(candidate.bounds)
  const value = candidate.value.toUpperCase()
  const componentPrefix = /^(R|C|D|Q|L|T|X)/.test(candidate.ref) || /^(R|C|D|Q|L|T|X)/.test(value)
  const connector = /^(P|J|CONN|HEADER|POWER|OUT)/.test(candidate.ref) || /^(CONN|HEADER|POWER|OUT)/.test(value)
  const namedHero = /^(U|IC)/.test(candidate.ref) || /ECC|NE|OP|AMP|SOIC|QFN|DIP|IC/.test(value) ? 3 : 0
  const usefulPads = candidate.padCount >= 2 && candidate.padCount <= 12 ? 1.2 : 0
  const moderateSize = Math.min(1.8, size.diagonal / 10)
  const compactness = size.area > 0 ? Math.min(1.2, Math.min(size.width, size.height) / Math.max(size.width, size.height)) : 0
  const complexity = Math.min(1.4, candidate.silkCount / 8)
  return namedHero + (componentPrefix ? 1.8 : 0) + (connector ? -1.4 : 0) + usefulPads + moderateSize + compactness + complexity - rank * 0.08 + tie * 0.02
}

function footprintCandidates(
  board: BoardModel,
  items: Map<string, InventoryItem>,
  actOrder: ActId[],
  seed: number | null
): FootprintCastCandidate[] {
  const rank = new Map(actOrder.map((id, index) => [id, index]))
  const candidates: FootprintCastCandidate[] = []
  for (const fp of board.footprints) {
    const rawRefs = [...new Set([...fp.padRefs, ...fp.silkRefs])]
    if (rawRefs.length > MAX_ASSEMBLY_MEMBERS) continue
    const refs = rawRefs
    const members = refs.map((ref) => items.get(ref)).filter((item): item is InventoryItem => item !== undefined)
    if (members.length === 0) continue
    let bounds: BBox | undefined
    for (const member of members) bounds = union(bounds, member.bounds)
    if (!bounds) continue
    if (members.length !== refs.length) continue
    const padCount = members.filter((member) => member.kind === 'pad').length
    const silkCount = members.filter((member) => member.kind === 'silk-line' || member.kind === 'arc').length
    const sourceAct = actForFootprint(board, fp.layer, members[0])
    const size = dimensions(bounds)
    const emptySilhouette = size.width < 0.35 && size.height < 0.35
    const namedHero = /^(U|IC)/.test(fp.ref) || /ECC|NE|OP|AMP|SOIC|QFN|DIP|IC/.test((fp.value ?? '').toUpperCase())
    const candidateBase = { ref: fp.ref, value: fp.value ?? fp.ref, sourceAct, members, bounds, padCount, silkCount }
    const pathological =
      fp.value?.toUpperCase() === 'MOUNTING_HOLE' ||
      size.area > 650 ||
      (size.diagonal > 42 && !namedHero) ||
      emptySilhouette ||
      (padCount === 0 && silkCount === 0)
    if (pathological) continue
    const base = candidateBase
    const tie = makeRng(seed, `cast-tie:${fp.ref}`).next()
    candidates.push({ ...base, score: candidateScore(base, rank.get(sourceAct) ?? actOrder.length, tie) })
  }
  return candidates.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref))
}

function heroVisualScore(candidate: FootprintCastCandidate): number {
  const size = dimensions(candidate.bounds)
  const compactness = size.area > 0 ? Math.min(size.width, size.height) / Math.max(size.width, size.height) : 0
  const connector = /^(P|J|CONN|HEADER|POWER|OUT)/.test(candidate.ref) || /^(CONN|HEADER|POWER|OUT)/.test(candidate.value.toUpperCase())
  const namedHero = /^(U|IC)/.test(candidate.ref) || /ECC|NE|OP|AMP|SOIC|QFN|DIP|IC/.test(candidate.value.toUpperCase())
  const outlineValue = Math.min(1.5, candidate.silkCount / 6)
  const circularPads = candidate.members.filter((member) => member.kind === 'pad' && member.value === 'circle').length
  const padRatio = circularPads / Math.max(1, candidate.padCount)
  const circularPenalty = padRatio > 0.75 && candidate.padCount >= 6 ? 4.5 : padRatio * 1.8
  const scalePreference = Math.max(0, 1.4 - Math.abs(size.diagonal - 16) / 12)
  return candidate.score * 0.45 + compactness * 2.4 + outlineValue + (namedHero ? 1.1 : 0) + (connector ? 0.2 : 0) + (componentPrefix(candidate.ref) ? 1.2 : 0) + scalePreference - circularPenalty - Math.abs(Math.log(Math.max(0.1, size.width) / Math.max(0.1, size.height))) * 0.35
}

function heroDiversity(a: FootprintCastCandidate, b: FootprintCastCandidate): number {
  const aSize = dimensions(a.bounds)
  const bSize = dimensions(b.bounds)
  const aAspect = aSize.width / Math.max(0.35, aSize.height)
  const bAspect = bSize.width / Math.max(0.35, bSize.height)
  const aspectDistance = Math.abs(Math.log(aAspect / bAspect))
  const areaDistance = Math.abs(Math.log(Math.max(0.1, aSize.area) / Math.max(0.1, bSize.area)))
  const familyDistance = componentPrefix(a.ref) === componentPrefix(b.ref) ? 0 : 0.7
  const valueDistance = a.value === b.value ? 0 : 0.8
  const silhouetteDistance = connectorCandidate(a) === connectorCandidate(b) ? 0 : 1.4
  const padDistance = Math.min(1, Math.abs(a.padCount - b.padCount) / 4)
  return aspectDistance + areaDistance * 0.45 + familyDistance + valueDistance + silhouetteDistance + padDistance * 0.35
}

function selectHeroes(pool: FootprintCastCandidate[], limit: number): FootprintCastCandidate[] {
  const ordered = [...pool].sort((a, b) => heroVisualScore(b) - heroVisualScore(a) || a.ref.localeCompare(b.ref))
  const selected: FootprintCastCandidate[] = []
  while (selected.length < limit && ordered.length > 0) {
    if (selected.length === 0) {
      const first = ordered.shift()
      if (first) selected.push(first)
      continue
    }
    const next = ordered
      .map((candidate, index) => ({ candidate, index, diversity: Math.min(...selected.map((chosen) => heroDiversity(chosen, candidate))) }))
      .sort((a, b) => b.diversity - a.diversity || heroVisualScore(b.candidate) - heroVisualScore(a.candidate) || a.candidate.ref.localeCompare(b.candidate.ref))[0]
    if (!next) break
    ordered.splice(next.index, 1)
    selected.push(next.candidate)
  }
  return selected
}

function anchorRank(footprintRef: string | undefined): number {
  const index = PREFERRED_ANCHOR_REFS.indexOf(footprintRef as typeof PREFERRED_ANCHOR_REFS[number])
  return index >= 0 ? index : PREFERRED_ANCHOR_REFS.length
}

function selectAnchorPads(items: Map<string, InventoryItem>): InventoryItem[] {
  const pads = [...items.values()]
    .filter((item) => item.kind === 'pad' && item.value === 'rect')
    .sort((a, b) => anchorRank(a.footprintRef) - anchorRank(b.footprintRef) ||
      (a.footprintRef ?? '').localeCompare(b.footprintRef ?? '') ||
      a.id.localeCompare(b.id))
  const selected: InventoryItem[] = []
  const selectedIds = new Set<string>()
  const selectedFootprints = new Set<string>()
  for (const pad of pads) {
    if (selected.length >= 4) break
    if (pad.footprintRef !== undefined && selectedFootprints.has(pad.footprintRef)) continue
    selected.push(pad)
    selectedIds.add(pad.id)
    if (pad.footprintRef !== undefined) selectedFootprints.add(pad.footprintRef)
  }
  if (selected.length < 4) {
    for (const pad of pads) {
      if (selected.length >= 4) break
      if (selectedIds.has(pad.id)) continue
      selected.push(pad)
      selectedIds.add(pad.id)
    }
  }
  return selected
}

function componentPrefix(ref: string): boolean {
  return /^(R|C|D|Q|L|T|X)/.test(ref)
}

function connectorCandidate(candidate: FootprintCastCandidate): boolean {
  return /^(P|J|CONN|HEADER|POWER|OUT)/.test(candidate.ref) || /^(CONN|HEADER|POWER|OUT)/.test(candidate.value.toUpperCase())
}

function isCircularAssembly(candidate: FootprintCastCandidate): boolean {
  const circularPads = candidate.members.filter((member) => member.kind === 'pad' && member.value === 'circle').length
  const padRatio = circularPads / Math.max(1, candidate.padCount)
  return candidate.padCount >= 6 && padRatio >= 0.75 && dimensions(candidate.bounds).diagonal >= 16
}

function castUnit(id: string, role: CastRole, members: InventoryItem[], sourceAct: ActId, sourceFootprintRefs: string[] = []): CastUnit | undefined {
  const refs = [...new Set(members.map((member) => member.id))].sort()
  if (refs.length === 0) return undefined
  let bounds: BBox | undefined
  for (const member of members) bounds = union(bounds, member.bounds)
  if (!bounds) return undefined
  return { id, role, memberRefs: refs, sourceFootprintRefs: [...sourceFootprintRefs].sort(), bounds, sourceAct }
}

function tracePathGroups(items: Map<string, InventoryItem>, seed: number | null): Array<{ id: string; members: InventoryItem[]; layer: string; score: number }> {
  const grouped = new Map<string, InventoryItem[]>()
  for (const item of items.values()) {
    if (item.kind !== 'trace') continue
    const key = `${item.layer}:${item.netId ?? item.id}`
    const members = grouped.get(key) ?? []
    members.push(item)
    grouped.set(key, members)
  }
  return [...grouped.entries()]
    .map(([key, members]) => {
      const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id))
      const bounds = ordered.reduce<BBox | undefined>((result, item) => union(result, item.bounds), undefined)
      if (!bounds) return undefined
      const size = dimensions(bounds)
      const length = ordered.reduce((total, item) => total + (item.length ?? 0), 0)
      const aspect = Math.max(size.width, size.height) / Math.max(0.35, Math.min(size.width, size.height))
      const usefulLength = Math.max(0, 1.8 - Math.abs(length - 24) / 24)
      const readableShape = Math.max(0, 1.4 - Math.max(0, aspect - 4) * 0.25)
      const score = usefulLength + readableShape + Math.min(1.5, ordered.length * 0.25) + makeRng(seed, `trace-path:${key}`).next() * 0.02
      return { id: key, members: ordered, layer: ordered[0]?.layer ?? '', score }
    })
    .filter((group): group is { id: string; members: InventoryItem[]; layer: string; score: number } => group !== undefined)
    .filter((group) => group.members.length >= 2 && group.members.reduce((total, item) => total + (item.length ?? 0), 0) >= 6)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5)
}

function buildCast(board: BoardModel, actOrder: ActId[], seed: number | null): CastBuildResult {
  const items = inventory(board)
  const anchorPads = selectAnchorPads(items)
  const candidates = footprintCandidates(board, items, actOrder, seed)
  const heroCandidates = candidates.filter((candidate) => {
    const size = dimensions(candidate.bounds)
    return candidate.padCount >= 2 && candidate.padCount <= 24 && size.diagonal >= 4 && size.diagonal <= 34 && size.area <= 540 && !isCircularAssembly(candidate) && !connectorCandidate(candidate)
  })
  const heroPool = [...heroCandidates].sort((a, b) => heroVisualScore(b) - heroVisualScore(a) || a.ref.localeCompare(b.ref))
  const heroLimit = Math.min(MAX_HERO_UNITS, Math.max(1, Math.ceil(heroPool.length / 4)))
  const heroes = selectHeroes(heroPool, heroLimit)
  const heroRefs = new Set(heroes.map((candidate) => candidate.ref))
  const detailCandidates = candidates.filter((candidate) => !heroRefs.has(candidate.ref)).slice(0, Math.max(0, MAX_ASSEMBLY_UNITS - heroes.length))
  const cast: CastUnit[] = []
  for (const candidate of heroes) {
    const unit = castUnit(`hero:${candidate.ref}`, 'hero-body', candidate.members, candidate.sourceAct, [candidate.ref])
    if (unit) cast.push(unit)
  }
  for (const candidate of detailCandidates) {
    const unit = castUnit(`detail:${candidate.ref}`, 'detail', candidate.members, candidate.sourceAct, [candidate.ref])
    if (unit) cast.push(unit)
  }

  for (const pad of anchorPads) {
    const sourceAct = actForFootprint(board, pad.layer, pad)
    const unit = castUnit(`anchor:${pad.id}`, 'anchor-pad', [pad], sourceAct)
    if (unit) cast.push(unit)
  }

  const castFootprints = new Set([...heroes, ...detailCandidates].map((candidate) => candidate.ref))
  const texts = [...items.values()]
    .filter((item) => item.kind === 'text' && item.value !== undefined && item.value.length > 0 && item.value.length <= 10 && !cast.some((unit) => unit.memberRefs.includes(item.id)))
    .sort((a, b) => {
      const aAttached = castFootprints.has(a.footprintRef ?? '') ? 1 : 0
      const bAttached = castFootprints.has(b.footprintRef ?? '') ? 1 : 0
      return bAttached - aAttached || (a.value ?? '').localeCompare(b.value ?? '') || a.id.localeCompare(b.id)
    })
    .slice(0, 8)
  for (const text of texts) {
    const sourceAct = `silk:${text.layer}` as ActId
    const unit = castUnit(`text:${text.id}`, 'text-accent', [text], sourceAct)
    if (unit) cast.push(unit)
  }

  const traces = tracePathGroups(items, seed)
  for (const trace of traces) {
    const sourceAct = `copper:${trace.layer}` as ActId
    const unit = castUnit(`trace:${trace.id}`, 'trace-accent', trace.members, sourceAct)
    if (unit) cast.push(unit)
  }

  const warnings: CastBuildResult['warnings'] = []
  if (heroes.length === 0) warnings.push({ code: 'cast-no-hero', message: 'board has no complete footprint suitable for a hero body; directed shots stay sparse' })
  if (anchorPads.length < 4) warnings.push({ code: 'cast-short-coda', message: `only ${anchorPads.length} rectangular anchor pads are available for the coda` })
  const result = { cast, warnings }
  semanticCastAssertions(result.cast, board)
  return result
}

function topology(mode: Exclude<ResolvedConfig['knobs']['symmetry'], 'auto'>): CopyTopology {
  return { mode, transforms: COPY_TRANSFORMS[mode].map((transform) => ({ ...transform })) }
}

function durationBoundaries(totalFrames: number): Array<{ id: ShotId; startFrame: number; endFrame: number }> {
  const last = Math.max(0, totalFrames - 1)
  return SHOT_IDS.map((id, index) => {
    const startRef = REFERENCE_BOUNDARIES[index] as number
    const endRef = REFERENCE_BOUNDARIES[index + 1] as number
    const startFrame = index === 0 ? 0 : Math.round((startRef / 166) * last)
    const endFrame = index === SHOT_IDS.length - 1 ? last : Math.max(startFrame, Math.round((endRef / 166) * last) - 1)
    return { id, startFrame, endFrame }
  })
}

function clampStage(value: number): number {
  return Math.max(0.04, Math.min(0.96, value))
}

function targetFor(
  shot: ShotId,
  index: number,
  count: number,
  symmetry?: Exclude<ResolvedConfig['knobs']['symmetry'], 'auto'>,
  unit?: CastUnit
): { x: number; y: number } {
  if (shot === 'corner-bridge' && unit?.role === 'anchor-pad') {
    return SHOT_SLOTS['corner-bridge']?.[(index + 1) % 4] ?? STAGE_CENTER
  }
  if (shot === 'corner-bridge' && unit?.role === 'trace-accent') {
    return SHOT_SLOTS['corner-bridge']?.[4 + (index % 3)] ?? STAGE_CENTER
  }
  if (unit?.role === 'trace-accent') {
    const side = index % 2 === 0 ? 0.28 : 0.72
    if (shot === 'corner-bridge') return point(side, index % 2 === 0 ? 0.42 : 0.58)
    if (shot === 'horizontal-study') return point(index % 2 === 0 ? 0.36 : 0.64, index % 2 === 0 ? 0.64 : 0.52)
  }
  if (shot === 'bilateral-tower' && unit !== undefined && isLargeAssembly(unit)) {
    return point(0.5, 0.5)
  }
  const slots = shot === 'bilateral-tower'
    ? symmetry === 'quad' || symmetry === 'mirror-x' ? TOWER_HALF_SLOTS : TOWER_FULL_SLOTS
    : SHOT_SLOTS[shot]
  if (!slots || slots.length === 0) return STAGE_CENTER
  const slotIndex = count <= slots.length
    ? Math.round((index / Math.max(1, count - 1)) * (slots.length - 1))
    : index % slots.length
  const direct = slots[slotIndex]
  if (direct) {
    if (shot === 'vertical-seed') {
      return point(direct.x, STAGE_CENTER.y + (direct.y - STAGE_CENTER.y) * 0.72)
    }
    if (shot === 'bilateral-tower') {
      const towerTarget = point(
        STAGE_CENTER.x + (direct.x - STAGE_CENTER.x) * 0.93,
        0.515 + (direct.y - STAGE_CENTER.y) * 1.04
      )
      if (unit?.role === 'detail' && index % 2 === 1) return point(1 - towerTarget.x, towerTarget.y)
      return towerTarget
    }
    if (shot === 'horizontal-study') {
      return point(
        STAGE_CENTER.x + (direct.x - STAGE_CENTER.x) * 0.93,
        STAGE_CENTER.y + (direct.y - STAGE_CENTER.y) * 0.85
      )
    }
    return direct
  }
  const normalized = count <= 1 ? 0.5 : index / Math.max(1, count - 1)
  const first = slots[0] as Vec2
  const last = slots[slots.length - 1] as Vec2
  return {
    x: first.x + (last.x - first.x) * normalized,
    y: first.y + (last.y - first.y) * normalized
  }
}

function codaFinalTarget(index: number): Vec2 {
  const column = index % 2
  const row = Math.floor(index / 2)
  return point(0.475 + column * 0.05, 0.46 + row * 0.08)
}

function orientationScore(unit: CastUnit, axis: 'horizontal' | 'vertical'): number {
  const size = dimensions(unit.bounds)
  const span = axis === 'horizontal' ? size.width : size.height
  const cross = axis === 'horizontal' ? size.height : size.width
  return span / Math.max(0.35, cross)
}

function compactnessScore(unit: CastUnit): number {
  const size = dimensions(unit.bounds)
  return Math.abs(Math.log(Math.max(0.35, size.width) / Math.max(0.35, size.height)))
}

function isLargeAssembly(unit: CastUnit): boolean {
  const size = dimensions(unit.bounds)
  return Math.max(size.width, size.height) > 18 || size.diagonal > 28
}

function isConnectorUnit(unit: CastUnit): boolean {
  const separator = unit.id.indexOf(':')
  const ref = separator >= 0 ? unit.id.slice(separator + 1) : unit.id
  return /^(P|J|CONN|HEADER)/.test(ref)
}

function orderUnits(units: CastUnit[], score: (unit: CastUnit) => number): CastUnit[] {
  return [...units].sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))
}

function castForShot(cast: CastUnit[], shot: ShotId, rhythmDensity: number, seedPairs: number): CastUnit[] {
  const heroes = cast.filter((unit) => unit.role === 'hero-body')
  const details = cast.filter((unit) => unit.role === 'detail')
  const anchors = cast.filter((unit) => unit.role === 'anchor-pad')
  const texts = cast.filter((unit) => unit.role === 'text-accent')
  const traces = cast.filter((unit) => unit.role === 'trace-accent')
  const connectorDetails = details.filter(isConnectorUnit)
  const componentDetails = details.filter((unit) => !isConnectorUnit(unit))
  const seedLimit = Math.max(1, Math.min(heroes.length + details.length, Math.round(seedPairs * 1.5) || 1))
  const componentUnits = [...heroes, ...details]
  const compactDetails = orderUnits(componentDetails.filter((unit) => !isLargeAssembly(unit)), (unit) => -orientationScore(unit, 'vertical'))
  const towerDetails = [
    ...orderUnits(componentDetails.filter((unit) => isLargeAssembly(unit)), (unit) => dimensions(unit.bounds).area).slice(0, 2),
    ...orderUnits(componentDetails.filter((unit) => !isLargeAssembly(unit) && dimensions(unit.bounds).area > 80), (unit) => -dimensions(unit.bounds).area),
    ...orderUnits(componentDetails.filter((unit) => !isLargeAssembly(unit) && dimensions(unit.bounds).area <= 80), (unit) => -orientationScore(unit, 'vertical'))
  ]
  const horizontalDetails = orderUnits(componentDetails, (unit) => -orientationScore(unit, 'horizontal'))
  switch (shot) {
    case 'vertical-seed':
      return [...compactDetails.slice(0, 3), ...connectorDetails.slice(0, 2), ...heroes].slice(0, Math.max(seedLimit + 2, Math.min(componentUnits.length, 9 + Math.round(rhythmDensity * 2))))
    case 'cross-collapse':
      return [...heroes.slice(0, 1), ...compactDetails.slice(0, 3), ...connectorDetails.slice(1, 2)].slice(0, Math.max(3, Math.min(5, componentUnits.length)))
    case 'radial-gate':
      return heroes.length > 0
        ? [...heroes, ...orderUnits(compactDetails, compactnessScore).slice(0, 2), ...connectorDetails.slice(2, 3)].slice(0, 5)
        : orderUnits(componentUnits, compactnessScore).slice(0, 4)
    case 'bilateral-tower':
      if (componentUnits.length === 0) return []
      return [
        ...towerDetails.slice(0, 1),
        ...heroes.slice(0, 1),
        ...towerDetails.slice(1, 2),
        ...heroes.slice(1, 2),
        ...towerDetails.slice(2),
        ...heroes.slice(2),
        ...connectorDetails,
        ...texts.slice(0, 1)
      ].slice(0, Math.max(6, Math.min(componentUnits.length + Math.min(1, texts.length), 10 + Math.round(rhythmDensity * 12))))
    case 'corner-bridge':
      return [...traces.slice(0, 3), ...anchors]
    case 'horizontal-study':
      return componentUnits.length > 0
        ? [...horizontalDetails.slice(0, 4), ...connectorDetails.slice(0, 3), ...texts.slice(0, 2), ...heroes.slice(0, 2), ...traces.slice(0, 2)]
        : anchors
    case 'pad-coda':
      return anchors
    case 'black-breath':
    case 'black-cut':
      return []
    default: {
      const never: never = shot
      throw new Error(`unknown shot ${String(never)}`)
    }
  }
}

function scaleFor(unit: CastUnit, shot: ShotId): number {
  const role = unit.role
  if (shot === 'pad-coda') return 0.65
  if (role === 'detail' && isConnectorUnit(unit)) {
    if (shot === 'vertical-seed') return 0.3
    if (shot === 'cross-collapse') return 0.4
    if (shot === 'radial-gate') return 0.28
    if (shot === 'bilateral-tower') return 0.25
    if (shot === 'horizontal-study') return 0.24
  }
  if (role === 'hero-body') {
    if (shot === 'bilateral-tower') return 0.42
    if (shot === 'vertical-seed') return 0.38
    if (shot === 'cross-collapse') return 0.76
    if (shot === 'radial-gate') return 0.35
    if (shot === 'corner-bridge') return 0.68
    if (shot === 'horizontal-study') return 0.38
    return 0.74
  }
  if (role === 'detail') {
    if (shot === 'horizontal-study') return isLargeAssembly(unit) ? 0.24 : 0.4
    if (shot === 'vertical-seed') return 0.65
    if (shot === 'cross-collapse') return 0.68
    if (shot === 'bilateral-tower') return isLargeAssembly(unit) ? 0.2 : 0.42
    return 0.7
  }
  if (role === 'anchor-pad') return shot === 'horizontal-study' ? 0.7 : shot === 'corner-bridge' ? 0.62 : 0.82
  if (role === 'text-accent') return shot === 'horizontal-study' ? 0.85 : shot === 'bilateral-tower' ? 0.75 : 1.25
  if (shot === 'horizontal-study') return 0.25
  if (shot === 'corner-bridge') return 0.34
  return 0.7
}

function topologyFor(
  shot: ShotId,
  mode: Exclude<ResolvedConfig['knobs']['symmetry'], 'auto'>,
  unit: CastUnit,
  index: number
): CopyTopology {
  if (shot === 'vertical-seed' || shot === 'cross-collapse' || shot === 'pad-coda') return topology('none')
  if (shot === 'radial-gate') return index === 0 ? topology(mode) : topology('none')
  if (shot === 'corner-bridge') return topology('none')
  if (shot === 'bilateral-tower') {
    if (unit.role === 'hero-body') {
      if (mode === 'quad') return topology('mirror-x')
      if (mode === 'mirror-x') return topology('mirror-x')
      return topology(mode)
    }
    if (unit.role === 'detail') {
      if (isLargeAssembly(unit)) return topology('none')
      if (index % 4 !== 0) return topology('none')
      if (mode === 'quad') return topology('mirror-x')
      return topology(mode)
    }
    return topology('none')
  }
  if (shot === 'horizontal-study' && unit.role === 'hero-body') {
    if (mode === 'quad') return topology('mirror-x')
    return topology(mode)
  }
  if (shot === 'horizontal-study' && unit.role === 'detail') {
    if (isLargeAssembly(unit)) return topology('none')
    if (index % 3 !== 0) return topology('none')
    if (mode === 'quad') return topology('mirror-x')
    return topology(mode)
  }
  return topology('none')
}

function rotationFor(shot: ShotId, unit: CastUnit, index: number): number {
  if (unit.role === 'text-accent') return index % 2 === 0 ? -2 : 2
  if (shot === 'vertical-seed' && unit.role === 'detail') {
    const cycle = [0, 90, 0, -90]
    return cycle[index % cycle.length] as number
  }
  if (shot === 'bilateral-tower') {
    if (unit.role === 'hero-body') return index % 2 === 0 ? 0 : 90
    const cycle = [0, 90, 0, -90]
    return cycle[index % cycle.length] as number
  }
  if (shot === 'horizontal-study' && unit.role === 'detail') {
    const cycle = [0, 90, 0, -90, 0]
    return cycle[index % cycle.length] as number
  }
  if (shot === 'corner-bridge' && unit.role === 'hero-body') return index % 2 === 0 ? 0 : 90
  return 0
}

function exitRank(shot: ShotId, unit: CastUnit, target: { x: number; y: number }, style: ResolvedConfig['knobs']['dissolveStyle']): number {
  const distance = Math.hypot(target.x - STAGE_CENTER.x, target.y - STAGE_CENTER.y)
  if (style === 'center-out') return distance
  if (style === 'wipe') return target.x + target.y
  if (style === 'scatter') return (unit.id.length * 17 + Math.round(target.x * 100) + Math.round(target.y * 100)) % 97
  return 0
}

function keyframesFor(
  shot: { id: ShotId; startFrame: number; endFrame: number },
  unit: CastUnit,
  target: { x: number; y: number },
  scale: number,
  index: number,
  total: number,
  config: ResolvedConfig,
  exitOffset: number
): DirectedKeyframe[] {
  const length = shot.endFrame - shot.startFrame + 1
  const enter = shot.id === 'bilateral-tower' ? Math.max(3, Math.min(6, Math.round(length * 0.12))) : Math.max(2, Math.min(10, Math.round(length * 0.16)))
  const exit = shot.id === 'horizontal-study' ? Math.max(6, Math.round(length * 0.23)) : Math.max(2, Math.min(6, Math.round(length * 0.14)))
  const staggerBudget = shot.id === 'vertical-seed'
    ? Math.max(16, Math.round(18 + config.knobs.rhythmDensity * 7))
    : shot.id === 'bilateral-tower'
      ? Math.max(8, Math.round(8 + config.knobs.rhythmDensity * 5))
      : shot.id === 'horizontal-study'
        ? Math.max(7, Math.round(7 + config.knobs.rhythmDensity * 4))
        : shot.id === 'corner-bridge'
          ? 3
          : 0
  const staggerProgress = shot.id === 'bilateral-tower' || shot.id === 'horizontal-study'
    ? Math.min(index, Math.max(0, total - 1 - index)) / Math.max(1, Math.floor(total / 2))
    : index / Math.max(1, total)
  const stagger = Math.min(Math.max(0, length - enter - exit - 1), Math.round(staggerProgress * staggerBudget))
  const start = shot.id === 'horizontal-study' ? shot.startFrame : shot.startFrame + stagger
  const roleOffset = shot.id === 'vertical-seed' || shot.id === 'pad-coda' ? 0 : index % 3
  const enterFrame = Math.min(shot.endFrame, start + enter + roleOffset + (shot.id === 'horizontal-study' ? stagger : 0))
  const holdEnd = Math.max(enterFrame, shot.endFrame - exit - exitOffset)
  const direction = index % 2 === 0 ? -1 : 1
  const drift = unit.role === 'trace-accent' ? 0.02 : 0.05
  const incoming = shot.id === 'cross-collapse'
    ? targetFor('vertical-seed', index, total)
    : shot.id === 'corner-bridge'
      ? { x: clampStage(target.x + direction * 0.03), y: clampStage(target.y - 0.02) }
      : shot.id === 'horizontal-study'
        ? { x: clampStage(target.x + direction * 0.015), y: clampStage(target.y) }
        : shot.id === 'bilateral-tower'
          ? {
              x: clampStage(target.x + direction * drift),
              y: clampStage(target.y + (target.y < STAGE_CENTER.y ? -drift : drift))
            }
          : { x: clampStage(target.x + direction * drift), y: clampStage(target.y - drift) }
  const horizontalEndContraction = target.y < STAGE_CENTER.y ? 0.33 : 0.29
  const horizontalGatherContraction = target.y < STAGE_CENTER.y ? 0.28 : 0.03
  const outgoing = shot.id === 'cross-collapse'
    ? {
        x: clampStage(STAGE_CENTER.x + (target.x - STAGE_CENTER.x) * 0.18),
        y: clampStage(STAGE_CENTER.y + (target.y - STAGE_CENTER.y) * 0.18)
      }
    : shot.id === 'horizontal-study'
    ? {
        x: clampStage(target.x + (STAGE_CENTER.x - target.x) * 0.28),
        y: clampStage(target.y + (STAGE_CENTER.y - target.y) * horizontalEndContraction)
      }
    : { x: clampStage(target.x - direction * drift), y: clampStage(target.y + drift) }
  const hiddenScale = Math.max(0.12, scale * 0.2)
  const rotation = rotationFor(shot.id, unit, index)
  const visible = (frame: number, x: number, y: number, valueScale: number, opacity: number, glow: number): DirectedKeyframe => ({
    frame,
    x,
    y,
    scale: valueScale,
    rotation,
    opacity,
    glow
  })
  const entryOpacity = shot.id === 'radial-gate'
    ? 0
    : shot.id === 'vertical-seed'
      ? 0.08
      : shot.id === 'bilateral-tower'
        ? 0.18
        : shot.id === 'horizontal-study'
          ? 0.3
    : shot.id === 'cross-collapse'
      ? 0.78
      : shot.id === 'pad-coda' || shot.id === 'corner-bridge'
        ? 0.96
        : 0.55
  const entryScale = shot.id === 'radial-gate' ? scale * 0.42 : shot.id === 'bilateral-tower' ? scale * 0.78 : shot.id === 'horizontal-study' ? scale * 0.85 : shot.id === 'pad-coda' ? scale * 0.86 : shot.id === 'vertical-seed' ? scale * 0.62 : scale * 0.7
  const endOpacity = shot.id === 'cross-collapse'
    ? 0.02
    : shot.id === 'bilateral-tower'
      ? 0.16
    : shot.id === 'corner-bridge'
      ? 1
      : shot.id === 'horizontal-study'
        ? 0.7
        : 0
  const endScale = shot.id === 'cross-collapse' ? scale * 0.28 : shot.id === 'bilateral-tower' ? scale * 0.72 : shot.id === 'corner-bridge' ? scale : shot.id === 'horizontal-study' ? scale * 0.95 : hiddenScale
  const frames = [
    visible(start, incoming.x, incoming.y, entryScale, entryOpacity, entryOpacity > 0 ? 0.35 : 0),
    visible(enterFrame, target.x, target.y, scale, 1, 1),
    visible(holdEnd, target.x, target.y, scale, 1, 1),
    visible(shot.endFrame, outgoing.x, outgoing.y, endScale, endOpacity, endOpacity > 0 ? 0.3 : 0)
  ]
  if (shot.id === 'pad-coda') {
    const codaStart = targetFor('pad-coda', index, total)
    const codaTarget = codaFinalTarget(index)
    const contractFrame = Math.min(shot.endFrame, shot.startFrame + Math.max(3, Math.round(length * 0.5)))
    const codaMid = point(
      codaStart.x + (codaTarget.x - codaStart.x) * 0.4,
      codaStart.y + (codaTarget.y - codaStart.y) * 0.4
    )
    return [
      visible(shot.startFrame, codaStart.x, codaStart.y, scale * 1.2, 0.95, 0.4),
      visible(contractFrame, codaMid.x, codaMid.y, scale * 1.1, 0.55, 0.35),
      visible(shot.endFrame, codaTarget.x, codaTarget.y, scale, 0.3, 0.2)
    ]
  }
  if (shot.id === 'radial-gate') {
    const firstReveal = Math.min(shot.endFrame, shot.startFrame + Math.max(2, Math.round(length * 0.33)))
    const secondReveal = Math.min(shot.endFrame, shot.startFrame + Math.max(4, Math.round(length * 0.7)))
    return [
      visible(shot.startFrame, target.x, target.y, scale * 0.38, 0, 0),
      visible(firstReveal, target.x, target.y, scale * 0.68, 0.2, 0.15),
      visible(secondReveal, target.x, target.y, scale * 0.9, 0.62, 0.55),
      visible(shot.endFrame, target.x, target.y, scale, 1, 1)
    ]
  }
  if (shot.id === 'corner-bridge') {
    const quietEnd = Math.min(shot.endFrame, start + 4 + exitOffset)
    const rise = Math.min(shot.endFrame - 1, start + 9 + exitOffset)
    return [
      visible(start, incoming.x, incoming.y, entryScale, 0, 0),
      visible(quietEnd, target.x, target.y, scale * 0.86, 0.04, 0.08),
      visible(Math.max(quietEnd, rise), target.x, target.y, scale * 0.94, 0.2, 0.18),
      visible(shot.endFrame, outgoing.x, outgoing.y, endScale, 1, 1)
    ]
  }
  if (shot.id === 'vertical-seed') {
    return [
      frames[0] as DirectedKeyframe,
      frames[1] as DirectedKeyframe,
      visible(shot.endFrame, target.x, target.y, scale, 0.52, 0.5)
    ]
  }
  if (shot.id === 'cross-collapse' || shot.id === 'horizontal-study') {
    if (shot.id === 'horizontal-study') {
      const gatherFrame = Math.max(holdEnd, shot.endFrame - 4)
      const gather = visible(
        gatherFrame,
        target.x,
        clampStage(target.y + (STAGE_CENTER.y - target.y) * horizontalGatherContraction),
        scale,
        1,
        1
      )
      if (gatherFrame > holdEnd) {
        return [frames[0] as DirectedKeyframe, frames[1] as DirectedKeyframe, frames[2] as DirectedKeyframe, gather, frames[3] as DirectedKeyframe]
      }
    }
    return [
      frames[0] as DirectedKeyframe,
      frames[1] as DirectedKeyframe,
      frames[2] as DirectedKeyframe,
      frames[3] as DirectedKeyframe
    ]
  }
  if (shot.endFrame - shot.startFrame <= 4) return [frames[0] as DirectedKeyframe, frames[3] as DirectedKeyframe]
  return frames
}

function compileShotTracks(
  cast: CastUnit[],
  shot: { id: ShotId; startFrame: number; endFrame: number },
  config: ResolvedConfig
): UnitTrack[] {
  const units = castForShot(cast, shot.id, config.knobs.rhythmDensity, config.knobs.seedPairs)
  const ordered = [...units]
  const targets = ordered.map((unit, index) => ({ unit, target: targetFor(shot.id, index, ordered.length, config.knobs.symmetry, unit) }))
  const ranked = [...targets].sort((a, b) => exitRank(shot.id, a.unit, a.target, config.knobs.dissolveStyle) - exitRank(shot.id, b.unit, b.target, config.knobs.dissolveStyle) || a.unit.id.localeCompare(b.unit.id))
  const rank = new Map(ranked.map((entry, index) => [entry.unit.id, index]))
  return targets.map(({ unit, target }, index) => {
    const copies = topologyFor(shot.id, config.knobs.symmetry, unit, index)
    const track = {
      castId: unit.id,
      copies,
      keyframes: keyframesFor(
        shot,
        unit,
        target,
        scaleFor(unit, shot.id),
        index,
        ordered.length,
        config,
        shot.id === 'horizontal-study' ? 0 : Math.min(3, Math.round((rank.get(unit.id) ?? 0) / Math.max(1, ordered.length / 3)))
      )
    }
    return track
  })
}

export function buildSemanticCast(board: BoardModel, actOrder: ActId[], seed: number | null): CastBuildResult {
  return buildCast(board, actOrder, seed)
}

export function compileDirectedShots(cast: CastUnit[], totalFrames: number, config: ResolvedConfig): FilmShot[] {
  const shots = durationBoundaries(totalFrames).map((shot) => ({
    ...shot,
    tracks: compileShotTracks(cast, shot, config)
  }))
  semanticShotAssertions(cast, shots, totalFrames)
  return shots
}

function semanticCastAssertions(cast: CastUnit[], board?: BoardModel): void {
  const ids = new Set<string>()
  const footprintByRef = new Map((board?.footprints ?? []).map((footprint) => [footprint.ref, footprint]))
  const geometryIds = board === undefined ? undefined : new Set(inventory(board).keys())
  const traceIds = new Set<string>()
  for (const copper of Object.values(board?.copper ?? {})) {
    for (const trace of copper.traces) traceIds.add(trace.id)
  }
  for (const unit of cast) {
    if (ids.has(unit.id)) throw new Error(`duplicate cast unit ${unit.id}`)
    ids.add(unit.id)
    if (unit.memberRefs.length === 0) throw new Error(`cast unit ${unit.id} has no geometry members`)
    if (unit.role === 'hero-body' && unit.memberRefs.length === 1) throw new Error(`hero cast unit ${unit.id} is a primitive, not a footprint assembly`)
    if (!Object.values(unit.bounds.min).every(Number.isFinite) || !Object.values(unit.bounds.max).every(Number.isFinite)) {
      throw new Error(`cast unit ${unit.id} has non-finite bounds`)
    }
    if (new Set(unit.memberRefs).size !== unit.memberRefs.length) throw new Error(`cast unit ${unit.id} repeats a geometry member`)
    if (new Set(unit.sourceFootprintRefs).size !== unit.sourceFootprintRefs.length) throw new Error(`cast unit ${unit.id} repeats a source footprint`)
    for (const memberRef of unit.memberRefs) {
      if (geometryIds !== undefined && !geometryIds.has(memberRef)) throw new Error(`cast unit ${unit.id} references missing geometry ${memberRef}`)
    }
    if (unit.role === 'hero-body' && unit.memberRefs.some((memberRef) => traceIds.has(memberRef))) {
      throw new Error(`hero cast unit ${unit.id} contains a standalone trace`)
    }
    if (unit.role === 'hero-body' || unit.role === 'detail') {
      const members = new Set(unit.memberRefs)
      const sources = unit.sourceFootprintRefs.map((ref) => footprintByRef.get(ref))
      if (sources.length === 0 || sources.some((footprint) => footprint === undefined)) throw new Error(`assembly cast unit ${unit.id} has no source footprint`)
      const expected = new Set(sources.flatMap((footprint) => [...(footprint?.padRefs ?? []), ...(footprint?.silkRefs ?? [])]))
      if (expected.size !== members.size || [...members].some((memberRef) => !expected.has(memberRef))) {
        throw new Error(`assembly cast unit ${unit.id} does not contain complete footprint membership`)
      }
      if (unit.role === 'hero-body' && sources.every((footprint) => (footprint?.padRefs.length ?? 0) === 0)) {
        throw new Error(`hero cast unit ${unit.id} has no footprint pads`)
      }
    } else if (unit.sourceFootprintRefs.length > 0) {
      throw new Error(`non-assembly cast unit ${unit.id} carries source footprints`)
    }
  }
}

function semanticShotAssertions(cast: CastUnit[], shots: FilmShot[], totalFrames: number): void {
  const castById = new Map(cast.map((unit) => [unit.id, unit]))
  if (shots.length !== SHOT_IDS.length) throw new Error(`directed grammar must contain ${SHOT_IDS.length} shots`)
  const lastFrame = Math.max(0, totalFrames - 1)
  let previousEnd = -1
  for (const shot of shots) {
    if (shot.startFrame !== previousEnd + 1) throw new Error(`shot ${shot.id} does not start after the previous shot`)
    if (shot.endFrame < shot.startFrame || shot.endFrame > lastFrame) throw new Error(`shot ${shot.id} has invalid frame bounds`)
    previousEnd = shot.endFrame
    const shotMembers = new Map<string, string>()
    for (const track of shot.tracks) {
      const unit = castById.get(track.castId)
      if (!unit) throw new Error(`shot ${shot.id} references missing cast unit ${track.castId}`)
      if (track.keyframes.length < 2) throw new Error(`shot ${shot.id} track ${track.castId} has too few keyframes`)
      if (track.copies.transforms.length === 0) throw new Error(`shot ${shot.id} track ${track.castId} has no copy transform`)
      if (unit.role === 'trace-accent' && shot.id !== 'corner-bridge' && shot.id !== 'horizontal-study') throw new Error(`trace ${unit.id} escaped a late shot`)
      if (unit.role === 'anchor-pad' && shot.id !== 'corner-bridge' && shot.id !== 'horizontal-study' && shot.id !== 'pad-coda') throw new Error(`anchor ${unit.id} escaped a late shot`)
      if (unit.role === 'text-accent' && shot.id !== 'bilateral-tower' && shot.id !== 'horizontal-study') {
        throw new Error(`text ${unit.id} escaped its directed shot window`)
      }
      for (const memberRef of unit.memberRefs) {
        const previousTrack = shotMembers.get(memberRef)
        if (previousTrack !== undefined) throw new Error(`shot ${shot.id} draws geometry ${memberRef} through both ${previousTrack} and ${unit.id}`)
        shotMembers.set(memberRef, unit.id)
      }
      let lastKeyframe = shot.startFrame - 1
      for (const keyframe of track.keyframes) {
        if (keyframe.frame < shot.startFrame || keyframe.frame > shot.endFrame || keyframe.frame < lastKeyframe) {
          throw new Error(`shot ${shot.id} track ${track.castId} has a keyframe outside its shot`)
        }
        if (![keyframe.x, keyframe.y, keyframe.scale, keyframe.rotation, keyframe.opacity, keyframe.glow].every(Number.isFinite)) {
          throw new Error(`shot ${shot.id} track ${track.castId} has non-finite keyframe data`)
        }
        lastKeyframe = keyframe.frame
      }
    }
  }
  if (previousEnd !== lastFrame) throw new Error(`directed grammar ends at ${previousEnd}, expected ${lastFrame}`)
}

export function compileDirectedBeats(totalFrames: number, config: ResolvedConfig): Array<{ frame: number; intensity: number }> {
  const count = Math.min(3, Math.max(0, Math.round(config.knobs.beatCount)))
  if (count === 0) return []
  const radial = Math.round((55 / 166) * Math.max(0, totalFrames - 1))
  const tower = Math.round((70 / 166) * Math.max(0, totalFrames - 1))
  const slots = [radial, tower, Math.round((120 / 166) * Math.max(0, totalFrames - 1))]
  return slots.slice(0, count).map((frame) => ({ frame, intensity: config.knobs.beatIntensity }))
}
