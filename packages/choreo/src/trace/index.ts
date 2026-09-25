import type { BoardModel } from '@silk-reel/ingest'
import type { ResolvedConfig } from '../config'
import type { TraceScene, TimelineWarning } from '../types'
import { buildTraceScene } from './scene'

export function compileTrace(board: BoardModel, resolved: ResolvedConfig, _seed: number): { scene: TraceScene; warnings: TimelineWarning[] } {
  return buildTraceScene(board, resolved)
}

export { growthSchedule } from './graph'
export type { GraphLink, GraphSeed, GraphSeg, GrowthResult } from './graph'
export { pickHero } from './hero'
export type { HeroPick } from './hero'
export { buildTraceScene, TRACE_BEATS } from './scene'
