import type { BoardModel } from '@silk-reel/ingest'
import type { ResolvedConfig } from '../config'
import type { TraceBeats, TraceScene, TimelineWarning } from '../types'

const BEATS: TraceBeats = {
  outline: [0, 0.1],
  pads: [0.05, 0.24],
  growth: [0.14, 0.72],
  zones: [0.6, 0.76],
  silk: [0.68, 0.84],
  hold: [0.82, 0.96],
  fade: [0.96, 1]
}

export function compileTrace(_board: BoardModel, resolved: ResolvedConfig, _seed: number): { scene: TraceScene; warnings: TimelineWarning[] } {
  return {
    scene: {
      outline: [],
      layers: [],
      pads: [],
      vias: [],
      zones: [],
      silkStrokes: [],
      texts: [],
      origin: { x: resolved.width / 2, y: resolved.height / 2 },
      camera: { from: 1, to: 1.05 },
      beats: BEATS
    },
    warnings: []
  }
}
