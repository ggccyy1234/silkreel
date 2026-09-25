import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig, Knobs } from '@silk-reel/choreo'
import type { BoardModel } from '@silk-reel/ingest'

export function compileStudioFilm(board: BoardModel, config: FilmConfig) {
  const timeline = compileTimeline(board, config)
  return {
    timeline,
    config: { ...config, seed: timeline.seedUsed },
    warnings: timeline.warnings.map((warning) => warning.message)
  }
}

export const KNOB_RANGES = {
  density: { min: 0.5, max: 1.5, step: 0.05 },
  texts: { min: 0, max: 1, step: 1 }
} as const

export const DEMO_BOARDS = [
  { id: 'ecc83-pp', label: 'ECC83 preamp', detail: '159 KB, through-hole valve preamp' },
  { id: 'kit-dev-coldfire-xilinx_5213', label: 'ColdFire dev kit', detail: '2.8 MB, through-hole + FPGA' },
  { id: 'video', label: 'Video board', detail: '5.8 MB, 4 copper layers, the stress test' }
] as const

export type StudioKnobs = Knobs

export interface StudioState {
  source:
    | { kind: 'demo'; demoId: string }
    | { kind: 'file'; fileName: string; boardText: string }
    | null
  knobs: StudioKnobs
  seed: number | null
  duration: 'auto' | number
}

export const DEFAULT_KNOBS: StudioKnobs = {
  density: 1,
  texts: 1
}
