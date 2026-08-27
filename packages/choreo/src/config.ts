import type { BoardModel } from '@silk-reel/ingest'
import { ChoreoConfigError } from './errors'
import { clamp } from './curves'
import type {
  ActId,
  DissolveStyle,
  EasingName,
  FilmConfig,
  Knobs,
  PaletteName,
  SymmetryMode
} from './types'

export interface ResolvedKnobs {
  symmetry: Exclude<SymmetryMode, 'auto'>
  rhythmDensity: number
  beatCount: number
  beatIntensity: number
  seedPairs: number
  dissolveStyle: DissolveStyle
  easing: EasingName
  glow: number
  flicker: number
  grain: number
  exposure: number
  palette: PaletteName
}

export interface ResolvedConfig {
  knobs: ResolvedKnobs
  seed: number | null
  durationSeconds: number | 'auto'
  width: number
  height: number
  fps: number
  actOrder: ActId[]
  knobWarnings: Array<{ code: string; message: string }>
}

export interface DurationPlan {
  durationSeconds: number
  totalFrames: number
  warnings: Array<{ code: string; message: string }>
}

export const MIN_ACT_SECONDS = 0.8
export const MIN_FILM_SECONDS = 6
export const MAX_FILM_SECONDS = 20

const SYMMETRY_MODES: readonly SymmetryMode[] = ['auto', 'mirror-x', 'mirror-y', 'quad', 'rotational180', 'none']
const DISSOLVE_STYLES: readonly DissolveStyle[] = ['center-out', 'fade', 'wipe', 'scatter']
const EASINGS: readonly EasingName[] = ['expo-out', 'back-out', 'linear', 'sine']
const PALETTE_NAMES: readonly PaletteName[] = ['mono', 'phosphor', 'amber', 'copper']

function requireEnum<T extends string>(field: string, value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined) return fallback
  if (!allowed.includes(value as T)) {
    throw new ChoreoConfigError(`knobs.${field}`, value, `expected one of ${allowed.join('|')}`)
  }
  return value as T
}

interface BoundedResult {
  value: number
  requested: number | undefined
}

function bounded(
  field: string,
  value: number | undefined,
  lo: number,
  hi: number,
  fallback: number,
  mode: 'reject' | 'clamp' = 'clamp'
): BoundedResult {
  if (value === undefined) return { value: fallback, requested: undefined }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ChoreoConfigError(`knobs.${field}`, value, 'expected a finite number')
  }
  if (value < lo || value > hi) {
    if (mode === 'clamp') return { value: clamp(value, lo, hi), requested: value }
    throw new ChoreoConfigError(`knobs.${field}`, value, `expected value in [${lo}, ${hi}]`)
  }
  return { value, requested: value }
}

export function resolveAutoSymmetry(board: BoardModel): Exclude<SymmetryMode, 'auto'> {
  const w = Math.abs(board.bbox.max.x - board.bbox.min.x)
  const h = Math.abs(board.bbox.max.y - board.bbox.min.y)
  if (h <= 0 || w / h >= 1.25) return 'mirror-y'
  if (w / h <= 0.8) return 'mirror-x'
  return 'quad'
}

export function resolveConfig(board: BoardModel, config: FilmConfig): ResolvedConfig {
  if (typeof config !== 'object') {
    throw new ChoreoConfigError('config', config, 'expected a FilmConfig object')
  }
  if (config.seed !== null && (typeof config.seed !== 'number' || !Number.isFinite(config.seed))) {
    throw new ChoreoConfigError('seed', config.seed, 'expected a finite number or null')
  }

  const knobs: Knobs = config.knobs
  if (typeof knobs !== 'object') throw new ChoreoConfigError('knobs', knobs, 'expected a knobs object')

  const symmetryRaw = requireEnum('symmetry', knobs.symmetry, SYMMETRY_MODES, 'auto')
  const rhythm = bounded('rhythmDensity', knobs.rhythmDensity, 0, 1, 0.5)
  const beatCountRaw = bounded('beatCount', knobs.beatCount, 0, 5, 1, 'clamp')
  const beatIntensity = bounded('beatIntensity', knobs.beatIntensity, 0, 1, 0.35)
  const seedPairs = bounded('seedPairs', knobs.seedPairs, 0, 24, 2, 'clamp')
  const dissolveStyle = requireEnum('dissolveStyle', knobs.dissolveStyle, DISSOLVE_STYLES, 'center-out')
  const easing = requireEnum('easing', knobs.easing, EASINGS, 'expo-out')
  const glow = bounded('glow', knobs.glow, 0, 1, 0)
  const flicker = bounded('flicker', knobs.flicker, 0, 1, 0)
  const grain = bounded('grain', knobs.grain, 0, 1, 0)
  const exposureRaw = bounded('exposure', knobs.exposure, 0.25, 2, 1)
  const palette = requireEnum('palette', knobs.palette, PALETTE_NAMES, 'mono')

  const knobWarnings: Array<{ code: string; message: string }> = []
  const pushWarning = (field: string, requested: number, clampedTo: number): void => {
    knobWarnings.push({ code: 'knob-clamped', message: `knobs.${field}=${requested} out of range; clamped to ${clampedTo}` })
  }
  if (rhythm.requested !== undefined && rhythm.value !== rhythm.requested) pushWarning('rhythmDensity', rhythm.requested, rhythm.value)
  if (beatCountRaw.requested !== undefined && beatCountRaw.value !== beatCountRaw.requested) pushWarning('beatCount', beatCountRaw.requested, beatCountRaw.value)
  if (beatIntensity.requested !== undefined && beatIntensity.value !== beatIntensity.requested) pushWarning('beatIntensity', beatIntensity.requested, beatIntensity.value)
  if (seedPairs.requested !== undefined && seedPairs.value !== seedPairs.requested) pushWarning('seedPairs', seedPairs.requested, seedPairs.value)
  if (glow.requested !== undefined && glow.value !== glow.requested) pushWarning('glow', glow.requested, glow.value)
  if (flicker.requested !== undefined && flicker.value !== flicker.requested) pushWarning('flicker', flicker.requested, flicker.value)
  if (grain.requested !== undefined && grain.value !== grain.requested) pushWarning('grain', grain.requested, grain.value)
  if (exposureRaw.requested !== undefined && exposureRaw.value !== exposureRaw.requested) pushWarning('exposure', exposureRaw.requested, exposureRaw.value)

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

  const actOrder = config.actOrder
  if (!Array.isArray(actOrder)) throw new ChoreoConfigError('actOrder', actOrder, 'expected an array of act ids')

  return {
    knobs: {
      symmetry: symmetryRaw === 'auto' ? resolveAutoSymmetry(board) : symmetryRaw,
      rhythmDensity: rhythm.value,
      beatCount: beatCountRaw.value,
      beatIntensity: beatIntensity.value,
      seedPairs: seedPairs.value,
      dissolveStyle,
      easing,
      glow: glow.value,
      flicker: flicker.value,
      grain: grain.value,
      exposure: exposureRaw.value,
      palette
    },
    seed: config.seed,
    durationSeconds: durationRaw,
    width: output.width,
    height: output.height,
    fps: output.fps,
    actOrder,
    knobWarnings
  }
}

export function totalElementEstimate(board: BoardModel): number {
  let n = board.outline.length + board.drill.length + board.stats.texts
  for (const s of Object.values(board.silkscreen)) n += s.lines.length
  for (const c of Object.values(board.copper)) {
    n += c.traces.length + c.pads.length + c.vias.length + c.zones.length
  }
  return n
}

export function autoDurationSeconds(totalElements: number): number {
  return clamp(MIN_FILM_SECONDS + 5 * Math.log10(1 + totalElements / 20), MIN_FILM_SECONDS, MAX_FILM_SECONDS)
}

export function planDuration(resolved: ResolvedConfig, totalElements: number): DurationPlan {
  const warnings: DurationPlan['warnings'] = []
  let seconds: number
  if (resolved.durationSeconds === 'auto') {
    seconds = autoDurationSeconds(totalElements)
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

export function copperLayerIds(board: BoardModel): string[] {
  const declared = board.layers.filter((l) => l.kind === 'copper').map((l) => l.id)
  const merged: string[] = []
  for (const id of [...declared, ...Object.keys(board.copper)]) if (!merged.includes(id)) merged.push(id)
  return merged
}

export function silkLayerIds(board: BoardModel): string[] {
  const declared = board.layers.filter((l) => l.kind === 'silk').map((l) => l.id)
  const merged: string[] = []
  for (const id of [...declared, ...Object.keys(board.silkscreen)]) if (!merged.includes(id)) merged.push(id)
  return merged
}

export function defaultActOrder(board: BoardModel): ActId[] {
  const acts: ActId[] = ['outline', 'drill']
  for (const layerId of copperLayerIds(board)) acts.push(`copper:${layerId}`)
  for (const layerId of silkLayerIds(board)) acts.push(`silk:${layerId}`)
  return acts
}
