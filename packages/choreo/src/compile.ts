import type { BoardModel } from '@silk-reel/ingest'
import { defaultActOrder, planDuration, resolveConfig, totalElementEstimate } from './config'
import { resolvePalette } from './curves'
import { buildSemanticCast, compileDirectedBeats, compileDirectedShots } from './director'
import { organicSeed } from './rng'
import type { ActId, FilmConfig, Timeline, TimelineWarning } from './types'

export function compileTimeline(board: BoardModel, config: FilmConfig): Timeline {
  const resolved = resolveConfig(board, config)
  const seed = resolved.seed ?? organicSeed()
  const directedConfig = { ...resolved, seed }
  const totalElements = totalElementEstimate(board)
  const duration = planDuration(resolved, totalElements)

  const availableActs = defaultActOrder(board)
  const requested: ActId[] = Array.isArray(config.actOrder) ? config.actOrder : []
  const unknownRequested = requested.filter((id) => !availableActs.includes(id))
  const orderedAvailable: ActId[] = [...requested.filter((id) => availableActs.includes(id))]
  for (const id of availableActs) if (!orderedAvailable.includes(id)) orderedAvailable.push(id)

  const semanticCast = buildSemanticCast(board, orderedAvailable, seed)

  const warnings: TimelineWarning[] = [
    ...duration.warnings,
    ...resolved.knobWarnings,
    ...semanticCast.warnings
  ]
  if (unknownRequested.length > 0) {
    warnings.push({
      code: 'act-order-ignored',
      message: `actOrder entries not present on this board were ignored: ${unknownRequested.join(', ')}`
    })
  }

  const shots = compileDirectedShots(semanticCast.cast, duration.totalFrames, directedConfig)
  const directedBeats = compileDirectedBeats(duration.totalFrames, directedConfig)

  return {
    fps: resolved.fps,
    totalFrames: duration.totalFrames,
    durationSeconds: duration.durationSeconds,
    width: resolved.width,
    height: resolved.height,
    output: { width: resolved.width, height: resolved.height, fps: resolved.fps },
    palette: resolvePalette(resolved.knobs.palette),
    cast: semanticCast.cast,
    shots,
    directedBeats,
    renderParams: {
      glow: resolved.knobs.glow,
      flicker: resolved.knobs.flicker,
      grain: resolved.knobs.grain,
      exposure: resolved.knobs.exposure,
      easing: resolved.knobs.easing,
      symmetry: resolved.knobs.symmetry
    },
    warnings,
    seedUsed: seed
  }
}
