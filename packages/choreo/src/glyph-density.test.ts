import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { sampleTrack } from './composer'
import { boardModel } from '../test/helpers'

const BOARDS = [
  'StickHub.kicad_pcb',
  'ecc83-pp.kicad_pcb',
  'glasgow.kicad_pcb',
  'icebreaker.kicad_pcb',
  'kit-dev-coldfire-xilinx_5213.kicad_pcb',
  'video.kicad_pcb'
]

const VISIBLE = 0.05

/** lit atom count at each output frame */
function litPerFrame(totalFrames: number, tracks: { knots: unknown[] }[]): number[] {
  const lit: number[] = []
  for (let f = 0; f < totalFrames; f++) {
    const p = f / totalFrames
    let n = 0
    for (const t of tracks) {
      for (const a of sampleTrack(t as Parameters<typeof sampleTrack>[0], p)) {
        if (a.alpha > VISIBLE) n++
      }
    }
    lit.push(n)
  }
  return lit
}

/** longest run of low-atom frames on the cyclic loop */
function longestLowRun(low: boolean[]): number {
  const anchor = low.indexOf(false)
  if (anchor < 0) return low.length
  let best = 0
  let run = 0
  for (let i = 1; i <= low.length; i++) {
    if (low[(anchor + i) % low.length] === true) {
      run++
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

describe('glyph dead-air budget', () => {
  for (const name of BOARDS) {
    it(`${name} keeps near-empty frames rare and short`, () => {
      const tl = compileTimeline(boardModel(name), {
        style: 'glyph',
        knobs: {},
        seed: 42,
        duration: 'auto',
        output: { width: 1080, height: 1350, fps: 15 }
      })
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      const lit = litPerFrame(tl.totalFrames, tl.tracks)
      const low = lit.map((n) => n < 3)
      const lowCount = low.reduce((n, v) => n + (v ? 1 : 0), 0)
      const run = longestLowRun(low)
      // under 8% of the loop sits nearly empty…
      expect(
        lowCount / tl.totalFrames,
        `${name}: ${lowCount}/${tl.totalFrames} frames below 3 atoms`
      ).toBeLessThanOrEqual(0.08)
      // …and no single dead stretch exceeds half a second
      const maxRun = Math.floor(0.5 * tl.fps)
      expect(run, `${name}: ${run} consecutive near-empty frames (max ${maxRun})`).toBeLessThanOrEqual(
        maxRun
      )
    })
  }
})
