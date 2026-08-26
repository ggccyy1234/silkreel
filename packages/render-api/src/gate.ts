import { runGate as runMetricsGate } from '@silk-reel/metrics'
export type { GateReport, GateExpectations } from '@silk-reel/metrics'

export function runGate(videoPath: string, expectations: Parameters<typeof runMetricsGate>[1]) {
  return runMetricsGate(videoPath, expectations)
}
