import type { BoardModel } from '@silk-reel/ingest'
import type { ResolvedConfig } from '../config'
import type { TraceScene, TimelineWarning } from '../types'
import { buildTraceScene } from './scene'

export function compileTrace(board: BoardModel, resolved: ResolvedConfig, seed: number): { scene: TraceScene; warnings: TimelineWarning[] } {
  return buildTraceScene(board, resolved, seed)
}

export { growthSchedule } from './graph'
export type { GraphLink, GraphSeed, GraphSeg, GrowthResult } from './graph'
export { pickHero } from './hero'
export type { HeroPick } from './hero'
export { buildTraceScene, TRACE_ACTS, TRACE_BEATS } from './scene'
export { bareName, groupNets, netKind } from './nets'
export { FOV, fitZoom, makeCam, norm, project, sampleShot } from './camera'
export type { Cam, V3 } from './camera'
export type { NetGroup, NetKind } from './nets'
