import type { BoardModel } from '@silk-reel/ingest'

export type ActId =
  | 'outline'
  | 'drill'
  | `copper:${string}`
  | `silk:${string}`

export type SymmetryMode = 'auto' | 'mirror-x' | 'mirror-y' | 'quad' | 'rotational180' | 'none'

export type DissolveStyle = 'center-out' | 'fade' | 'wipe' | 'scatter'

export type EasingName = 'expo-out' | 'back-out' | 'linear' | 'sine'

export type PaletteName = 'mono' | 'phosphor' | 'amber' | 'copper'

export interface Knobs {
  symmetry?: SymmetryMode
  rhythmDensity?: number
  beatCount?: number
  beatIntensity?: number
  seedPairs?: number
  dissolveStyle?: DissolveStyle
  easing?: EasingName
  glow?: number
  flicker?: number
  grain?: number
  exposure?: number
  palette?: PaletteName
}

export interface FilmConfig {
  actOrder: ActId[]
  knobs: Knobs
  seed: number | null
  duration: 'auto' | number
  output: { width: number; height: number; fps: number }
}

export type PhaseKind = 'seed' | 'populate' | 'beat' | 'build' | 'sustain' | 'dissolve'

export interface PhaseSpec {
  kind: PhaseKind
  startFrame: number
  endFrame: number
}

export interface Act {
  id: ActId
  unit: string
  layerId: string
  startFrame: number
  endFrame: number
  phases: PhaseSpec[]
}

export interface Keyframe {
  frame: number
  opacity: number
  scaleX: number
  scaleY: number
  glow: number
  dx?: number
  dy?: number
}

export interface TimelineElement {
  id: string
  kind: string
  layer: string
  geomRef: string
  actId: string
  keyframes: Keyframe[]
  placement: { dx: number; dy: number }
}

export interface Rgb {
  r: number | null
  g: number | null
  b: number | null
}

export interface PaletteDef {
  name: PaletteName
  stroke: Rgb
  glowHue: Rgb
}

export interface RenderParams {
  glow: number
  flicker: number
  grain: number
  exposure: number
  easing: EasingName
}

export interface TimelineWarning {
  code: string
  message: string
}

export interface Timeline {
  fps: number
  totalFrames: number
  durationSeconds: number
  width: number
  height: number
  palette: PaletteDef
  acts: Act[]
  elements: TimelineElement[]
  beats: Array<{ frame: number; intensity: number }>
  renderParams: RenderParams
  warnings: TimelineWarning[]
  seedUsed: number | null
}

export type CompileTimeline = (board: BoardModel, config: FilmConfig) => Timeline
