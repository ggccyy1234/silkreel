import type { BoardModel } from '@silk-reel/ingest'
import { planDuration, resolveConfig } from './config'
import { composeFilm } from './composer'
import { organicSeed } from './rng'
import type { FilmConfig, Palette, Timeline } from './types'

const glyphPalette: Palette = {
  id: 'mono',
  bg: '#050505',
  copper: '#f2f2f2',
  copperDim: '#5a5a5a',
  silk: '#ffffff',
  head: '#ffffff',
  bloom: 0.35
}

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
    style: 'glyph',
    palette: glyphPalette,
    title: undefined,
    transparent: false,
    ...film,
    warnings: [...duration.warnings, ...resolved.knobWarnings, ...film.warnings],
    seedUsed: seed
  }
}
