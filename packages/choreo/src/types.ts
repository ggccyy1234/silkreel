import type { BBox, BoardModel } from '@silk-reel/ingest'

export type ActId =
  | 'outline'
  | 'drill'
  | `copper:${string}`
  | `silk:${string}`

export type SymmetryMode = 'auto' | 'mirror-x' | 'mirror-y' | 'quad' | 'rotational180' | 'none'

export type DissolveStyle = 'center-out' | 'fade' | 'wipe' | 'scatter'

export type EasingName = 'expo-out' | 'back-out' | 'linear' | 'sine'

export type PaletteName = 'mono' | 'phosphor' | 'amber' | 'copper'

export type ShotId =
  | 'black-breath'
  | 'vertical-seed'
  | 'cross-collapse'
  | 'radial-gate'
  | 'bilateral-tower'
  | 'corner-bridge'
  | 'horizontal-study'
  | 'pad-coda'
  | 'black-cut'

export type CastRole = 'hero-body' | 'detail' | 'anchor-pad' | 'text-accent' | 'trace-accent'

export interface CastUnit {
  id: string
  role: CastRole
  memberRefs: string[]
  bounds: BBox
  sourceAct: ActId
}

export interface CopyTransform {
  x: -1 | 1
  y: -1 | 1
}

export interface CopyTopology {
  mode: Exclude<SymmetryMode, 'auto'>
  transforms: CopyTransform[]
}

export interface DirectedKeyframe {
  frame: number
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  glow: number
}

export interface UnitTrack {
  castId: string
  copies: CopyTopology
  keyframes: DirectedKeyframe[]
}

export interface FilmShot {
  id: ShotId
  startFrame: number
  endFrame: number
  tracks: UnitTrack[]
}

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
  symmetry: Exclude<SymmetryMode, 'auto'>
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
  output: { width: number; height: number; fps: number }
  palette: PaletteDef
  cast: CastUnit[]
  shots: FilmShot[]
  directedBeats: Array<{ frame: number; intensity: number }>
  renderParams: RenderParams
  warnings: TimelineWarning[]
  seedUsed: number
}

export type CompileTimeline = (board: BoardModel, config: FilmConfig) => Timeline
