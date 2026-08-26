import type { ActId, Knobs, PaletteName } from '@silk-reel/choreo'

export const PALETTE_ACCENTS: Record<PaletteName, { ink: string; glow: string }> = {
  mono: { ink: '#c9c9c9', glow: '#8a8a8a' },
  phosphor: { ink: '#7fd8a0', glow: '#40b478' },
  amber: { ink: '#e0b06a', glow: '#c98f3d' },
  copper: { ink: '#d89a78', glow: '#b47450' }
}

export const KNOB_RANGES = {
  rhythmDensity: { min: 0, max: 1, step: 0.01 },
  beatCount: { min: 0, max: 5, step: 1 },
  beatIntensity: { min: 0, max: 1, step: 0.01 },
  seedPairs: { min: 0, max: 24, step: 1 },
  glow: { min: 0, max: 1, step: 0.01 },
  flicker: { min: 0, max: 1, step: 0.01 },
  grain: { min: 0, max: 1, step: 0.01 },
  exposure: { min: 0.25, max: 2, step: 0.01 }
} as const

export const SYMMETRY_OPTIONS = ['auto', 'mirror-x', 'mirror-y', 'quad', 'rotational180', 'none'] as const
export const DISSOLVE_OPTIONS = ['center-out', 'fade', 'wipe', 'scatter'] as const
export const EASING_OPTIONS = ['expo-out', 'back-out', 'linear', 'sine'] as const
export const PALETTE_OPTIONS = Object.keys(PALETTE_ACCENTS) as PaletteName[]

export const DEMO_BOARDS = [
  { id: 'ecc83-pp', label: 'ECC83 preamp', detail: '159 KB, 2 layers, small through-hole board' },
  { id: 'kit-dev-coldfire-xilinx_5213', label: 'ColdFire dev kit', detail: '2.8 MB, through-hole + FPGA' },
  { id: 'video', label: 'Video board', detail: '5.8 MB, 4 copper layers, the stress test' }
] as const

export type StudioKnobs = Knobs

export interface StudioState {
  source:
    | { kind: 'demo'; demoId: string }
    | { kind: 'file'; fileName: string; boardText: string }
    | null
  actOrder: ActId[]
  knobs: StudioKnobs
  seed: number | null
  duration: 'auto' | number
}

export const DEFAULT_KNOBS: StudioKnobs = {
  symmetry: 'auto',
  rhythmDensity: 0.5,
  beatCount: 1,
  beatIntensity: 0.35,
  seedPairs: 2,
  dissolveStyle: 'center-out',
  easing: 'expo-out',
  glow: 0,
  flicker: 0,
  grain: 0,
  exposure: 1,
  palette: 'mono'
}
