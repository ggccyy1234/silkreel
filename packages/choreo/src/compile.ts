import type { BoardModel, Vec2 } from '@silk-reel/ingest'
import { planDuration, resolveConfig, totalElementEstimate } from './config.js'
import { resolvePalette } from './curves.js'
import { makeRng } from './rng.js'
import { assignElementsToActs, pairUnits, schedulesToElements, scheduleAct, splitActPhases } from './phases.js'
import type { Act, ActId, FilmConfig, Timeline, TimelineWarning } from './types.js'

export function compileTimeline(board: BoardModel, config: FilmConfig): Timeline {
  const resolved = resolveConfig(board, config)
  const totalElements = totalElementEstimate(board)
  const duration = planDuration(resolved, totalElements)

  const availableActs = defaultActsOf(board)
  const requested: ActId[] = Array.isArray(config.actOrder) ? config.actOrder : []
  const unknownRequested = requested.filter((id) => !availableActs.includes(id))
  const orderedAvailable: ActId[] = [...requested.filter((id) => availableActs.includes(id))]
  for (const id of availableActs) if (!orderedAvailable.includes(id)) orderedAvailable.push(id)

  const { contents } = assignElementsToActs(board, orderedAvailable)
  const order = orderedAvailable.filter((id) => (contents.get(id)?.length ?? 0) > 0)

  const totalUnits = order.reduce((n, id) => n + (contents.get(id)?.length ?? 0), 0)
  void totalUnits
  const minLastFramesCount = Math.max(1, Math.round(1.2 * resolved.fps))
  const weights = new Map<string, number>()
  for (const id of order) {
    const unitCount = contents.get(id)?.length ?? 1
    weights.set(id, Math.sqrt(Math.max(1, unitCount)))
  }
  const weightSum = [...weights.values()].reduce((a, b) => a + b, 0)
  const lastWeightShare =
    order.length >= 2
      ? (weights.get(order[order.length - 1] as string) ?? 1) / weightSum
      : 1

  const warnings: TimelineWarning[] = [...duration.warnings, ...resolved.knobWarnings]
  if (unknownRequested.length > 0) {
    warnings.push({
      code: 'act-order-ignored',
      message: `actOrder entries not present on this board were ignored: ${unknownRequested.join(', ')}`
    })
  }

  const center: Vec2 = {
    x: (board.bbox.min.x + board.bbox.max.x) / 2,
    y: (board.bbox.min.y + board.bbox.max.y) / 2
  }

  const fps = resolved.fps
  const acts: Act[] = []
  const elements: Timeline['elements'] = []
  const beats: Timeline['beats'] = []

  const beatBudget = Math.round(resolved.knobs.beatCount)
  const carryingCandidates = order.filter((id) => id.startsWith('copper:') || id.startsWith('silk:'))
  const carriers = new Set<ActId>()
  if (beatBudget > 0 && carryingCandidates.length > 0) {
    const stride = Math.max(1, Math.floor(carryingCandidates.length / beatBudget))
    for (let i = 0; i < carryingCandidates.length && carriers.size < Math.min(beatBudget, carryingCandidates.length); i += stride) {
      carriers.add(carryingCandidates[i] as ActId)
    }
    let scan = 0
    while (carriers.size < Math.min(beatBudget, carryingCandidates.length) && scan < carryingCandidates.length * 2) {
      const candidate = carryingCandidates[scan % carryingCandidates.length] as ActId
      if (!carriers.has(candidate)) carriers.add(candidate)
      scan++
    }
  }

  let cursor = 0
  const lastActFrames = Math.max(
    minLastFramesCount,
    Math.round(duration.totalFrames * Math.min(0.35, lastWeightShare * 1.6))
  )
  const framesForRest = duration.totalFrames - (order.length >= 2 ? lastActFrames : duration.totalFrames)
  const nonLastCount = Math.max(1, order.length - 1)
  const perActRaw = order.length >= 2 ? framesForRest / nonLastCount : 0

  order.forEach((id, actIndex) => {
    const isLast = actIndex === order.length - 1
    const startFrame = cursor
    const endFrame = isLast
      ? duration.totalFrames - 1
      : startFrame + Math.max(2, Math.round(perActRaw)) - 1
    cursor = endFrame + 1

    const units = contents.get(id) ?? []
    const actLen = endFrame - startFrame + 1
    let carriesBeat = carriers.has(id) && actLen >= 12
    if (carriers.has(id) && !carriesBeat) {
      warnings.push({
        code: 'beat-dropped-short-act',
        message: `act ${id} carries a beat but is only ${actLen} frames; a beat needs ≥12 frames so tail phases would spill into the next act — beat dropped`
      })
    }
    const split = splitActPhases(startFrame, endFrame, fps, carriesBeat)
    if (carriesBeat && split.beat === undefined) {
      carriesBeat = false
      warnings.push({
        code: 'beat-dropped-phase-floors',
        message: `act ${id} cannot fit a beat without violating minimum phase floors (len ${actLen}); beat dropped`
      })
    }

    const groups = pairUnits(units, center, resolved.knobs.symmetry)
    const actRng = makeRng(resolved.seed, `act:${id}`)

    const result = scheduleAct({
      groups,
      split,
      rngInt: (a, b) => actRng.int(a, b),
      shuffle: <T,>(items: T[]) => actRng.shuffle(items),
      center,
      seedPairs: resolved.knobs.seedPairs,
      rhythmDensity: resolved.knobs.rhythmDensity,
      beatIntensity: resolved.knobs.beatIntensity,
      flicker: resolved.knobs.flicker,
      dissolveStyle: resolved.knobs.dissolveStyle,
      easing: resolved.knobs.easing,
      isFinalAct: isLast,
      totalFrames: duration.totalFrames,
      carriesBeat
    })

    if (carriesBeat && result.beatFrame !== undefined) {
      beats.push({ frame: result.beatFrame, intensity: resolved.knobs.beatIntensity })
    }

    acts.push({ id, unit: unitLabel(id), layerId: layerOf(id), startFrame, endFrame, phases: split.phases })
    elements.push(...schedulesToElements(result.schedules, id))
  })

  return {
    fps,
    totalFrames: duration.totalFrames,
    durationSeconds: duration.durationSeconds,
    width: resolved.width,
    height: resolved.height,
    palette: resolvePalette(resolved.knobs.palette),
    acts,
    elements,
    beats,
    renderParams: {
      glow: resolved.knobs.glow,
      flicker: resolved.knobs.flicker,
      grain: resolved.knobs.grain,
      exposure: resolved.knobs.exposure,
      easing: resolved.knobs.easing
    },
    warnings,
    seedUsed: resolved.seed
  }
}

function defaultActsOf(board: BoardModel): ActId[] {
  const acts: ActId[] = ['outline', 'drill']
  const copperIds = new Set(board.layers.filter((l) => l.kind === 'copper').map((l) => l.id))
  for (const id of Object.keys(board.copper)) copperIds.add(id)
  for (const id of copperIds) acts.push(`copper:${id}`)
  const silkIds = new Set(board.layers.filter((l) => l.kind === 'silk').map((l) => l.id))
  for (const id of Object.keys(board.silkscreen)) silkIds.add(id)
  for (const id of silkIds) acts.push(`silk:${id}`)
  return acts
}

function unitLabel(id: ActId): string {
  return id.includes(':') ? (id.split(':')[1] ?? id) : id
}

function layerOf(id: ActId): string {
  if (id === 'outline') return 'Edge.Cuts'
  if (id === 'drill') return 'drill'
  return id.split(':')[1] ?? id
}
