#!/usr/bin/env tsx
// Prints when things first become visible in a trace scene (seconds): first
// copper seg start, the 5/50/95% seg-start quantiles, pad pops — to find dead air.
// usage: npx tsx scripts/trace-timing.mts [board ...]
import { compileTimeline } from '../packages/choreo/src/index.js'
import { loadDemoBoard, defaultFilmConfig, DEMO_BOARDS } from '../packages/render-api/src/boards.js'

const boards = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [...DEMO_BOARDS]
for (const id of boards) {
  const tl = compileTimeline(await loadDemoBoard(id), { ...defaultFilmConfig(id), style: 'trace' })
  if (tl.style !== 'trace') continue
  const s = (p: number): string => (p * tl.durationSeconds).toFixed(2)
  const t0s = tl.scene.layers.flatMap((l) => l.segs.filter((_, i) => i % 7 === 5)).sort((a, b) => a - b)
  const q = (f: number): number => t0s[Math.min(t0s.length - 1, Math.floor(f * t0s.length))] ?? NaN
  const pads = tl.scene.pads.map((p) => p.t).sort((a, b) => a - b)
  const pq = (f: number): number => pads[Math.min(pads.length - 1, Math.floor(f * pads.length))] ?? NaN
  console.log(`${id.padEnd(30)} dur=${tl.durationSeconds}s segs=${t0s.length} seg t0: first=${s(q(0))} q5=${s(q(0.05))} q50=${s(q(0.5))} q95=${s(q(0.95))} | pads first=${s(pq(0))} q5=${s(pq(0.05))} q50=${s(pq(0.5))} | beats=${JSON.stringify(tl.scene.beats)}`)
}
