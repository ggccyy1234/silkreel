import type { BoardModel } from '@silk-reel/ingest'
import { planDuration, resolveConfig } from './config'
import { composeFilm } from './composer'
import { organicSeed } from './rng'
import type { FilmConfig, Timeline } from './types'

export function compileTimeline(board: BoardModel, config: FilmConfig): Timeline {
  const resolved = resolveConfig(config)
  const seed = resolved.seed ?? organicSeed()
  const duration = planDuration(resolved)
  const film = composeFilm(board, resolved, seed)

  return {
    fps: resolved.fps,
    totalFrames: duration.totalFrames,
    durationSeconds: duration.durationSeconds,
    width: resolved.width,
    height: resolved.height,
    output: { width: resolved.width, height: resolved.height, fps: resolved.fps },
    ...film,
    warnings: [...duration.warnings, ...resolved.knobWarnings, ...film.warnings],
    seedUsed: seed
  }
}
