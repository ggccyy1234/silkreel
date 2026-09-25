import { ChoreoConfigError } from './errors'
import { clamp } from './curves'
import type { CastHints, FilmConfig, Knobs } from './types'

export interface ResolvedKnobs {
  density: number
  texts: number
}

export interface ResolvedConfig {
  knobs: ResolvedKnobs
  seed: number | null
  durationSeconds: number | 'auto'
  width: number
  height: number
  fps: number
  cast?: CastHints | undefined
  knobWarnings: Array<{ code: string; message: string }>
}

export interface DurationPlan {
  durationSeconds: number
  totalFrames: number
  warnings: Array<{ code: string; message: string }>
}

export const MIN_FILM_SECONDS = 6
export const MAX_FILM_SECONDS = 20

function bounded(
  field: string,
  value: number | undefined,
  lo: number,
  hi: number,
  fallback: number
): { value: number; requested: number | undefined } {
  if (value === undefined) return { value: fallback, requested: undefined }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ChoreoConfigError(`knobs.${field}`, value, 'expected a finite number')
  }
  if (value < lo || value > hi) return { value: clamp(value, lo, hi), requested: value }
  return { value, requested: value }
}

export function resolveConfig(config: FilmConfig): ResolvedConfig {
  if (typeof config !== 'object') {
    throw new ChoreoConfigError('config', config, 'expected a FilmConfig object')
  }
  if (config.seed !== null && (typeof config.seed !== 'number' || !Number.isFinite(config.seed))) {
    throw new ChoreoConfigError('seed', config.seed, 'expected a finite number or null')
  }

  const knobs: Knobs = config.knobs
  if (typeof knobs !== 'object') throw new ChoreoConfigError('knobs', knobs, 'expected a knobs object')

  const density = bounded('density', knobs.density, 0.5, 1.5, 1)
  const texts = bounded('texts', knobs.texts, 0, 1, 1)

  const knobWarnings: Array<{ code: string; message: string }> = []
  for (const [field, result] of Object.entries({ density, texts })) {
    if (result.requested !== undefined && result.value !== result.requested) {
      knobWarnings.push({
        code: 'knob-clamped',
        message: `knobs.${field}=${result.requested} out of range; clamped to ${result.value}`
      })
    }
  }

  const durationRaw: 'auto' | number = config.duration
  if (durationRaw !== 'auto') {
    if (typeof durationRaw !== 'number' || !Number.isFinite(durationRaw)) {
      throw new ChoreoConfigError('duration', durationRaw, "expected 'auto' or a finite number of seconds")
    }
    if (durationRaw <= 0) {
      throw new ChoreoConfigError('duration', durationRaw, 'duration must be positive')
    }
  }

  const output = config.output
  if (typeof output !== 'object' || !Number.isInteger(output.width) || output.width <= 0 || output.width > 8192) {
    throw new ChoreoConfigError('output.width', output.width, 'expected an integer in [1, 8192]')
  }
  if (!Number.isInteger(output.height) || output.height <= 0 || output.height > 8192) {
    throw new ChoreoConfigError('output.height', output.height, 'expected an integer in [1, 8192]')
  }
  if (!Number.isFinite(output.fps) || output.fps <= 0 || output.fps > 240) {
    throw new ChoreoConfigError('output.fps', output.fps, 'expected fps in (0, 240]')
  }

  const cast: unknown = config.cast
  if (cast !== undefined) {
    if (typeof cast !== 'object' || cast === null || Array.isArray(cast)) {
      throw new ChoreoConfigError('cast', cast, 'expected a CastHints object')
    }
    for (const [key, list] of Object.entries(cast)) {
      if (key !== 'preferRefs' && key !== 'preferTexts') {
        throw new ChoreoConfigError(`cast.${key}`, list, 'expected preferRefs or preferTexts')
      }
      if (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || v.length === 0) || list.length > 32) {
        throw new ChoreoConfigError(`cast.${key}`, list, 'expected an array of up to 32 non-empty strings')
      }
    }
  }

  return {
    knobs: { density: density.value, texts: texts.value },
    seed: config.seed,
    durationSeconds: durationRaw,
    width: output.width,
    height: output.height,
    fps: output.fps,
    cast: cast,
    knobWarnings
  }
}

/** the loop's content doesn't scale with board size — a fixed ~11s cycle */
export function autoDurationSeconds(): number {
  return 167 / 15
}

export function planDuration(resolved: Pick<ResolvedConfig, 'durationSeconds' | 'fps'>): DurationPlan {
  const warnings: DurationPlan['warnings'] = []
  let seconds: number
  if (resolved.durationSeconds === 'auto') {
    seconds = autoDurationSeconds()
  } else {
    seconds = resolved.durationSeconds
    if (seconds < MIN_FILM_SECONDS) {
      warnings.push({
        code: 'duration-clamped',
        message: `requested duration ${seconds}s is below the ${MIN_FILM_SECONDS}s minimum film length; clamped to ${MIN_FILM_SECONDS}s`
      })
      seconds = MIN_FILM_SECONDS
    }
    if (seconds > MAX_FILM_SECONDS) {
      warnings.push({
        code: 'duration-clamped',
        message: `requested duration ${seconds}s exceeds the ${MAX_FILM_SECONDS}s cap; clamped to ${MAX_FILM_SECONDS}s`
      })
      seconds = MAX_FILM_SECONDS
    }
  }
  seconds = Math.round(seconds * resolved.fps) / resolved.fps
  return { durationSeconds: seconds, totalFrames: Math.round(seconds * resolved.fps), warnings }
}
