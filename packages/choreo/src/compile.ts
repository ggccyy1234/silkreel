import type { BoardModel } from '@silk-reel/ingest'
import { planDuration, resolveConfig } from './config'
import { composeFilm } from './composer'
import { organicSeed } from './rng'
import { compileTrace } from './trace/index'
import type { FilmConfig, Timeline } from './types'

export function compileTimeline(board: BoardModel, config: FilmConfig): Timeline {
  const resolved = resolveConfig(config)
  const seed = resolved.seed ?? organicSeed()
  const duration = planDuration(resolved)
  const base = {
    fps: resolved.fps,
    totalFrames: duration.totalFrames,
    durationSeconds: duration.durationSeconds,
    width: resolved.width,
    height: resolved.height,
    output: { width: resolved.width, height: resolved.height, fps: resolved.fps },
    palette: resolved.palette,
    title: resolved.title,
    transparent: resolved.transparent,
    seedUsed: seed
  }
  if (resolved.style === 'trace') {
    const t = compileTrace(board, resolved, seed)
    return { ...base, style: 'trace', scene: t.scene, warnings: [...duration.warnings, ...resolved.knobWarnings, ...t.warnings] }
  }
  const film = composeFilm(board, resolved, seed)
  return { ...base, style: 'glyph', ...film, warnings: [...duration.warnings, ...resolved.knobWarnings, ...film.warnings] }
}
