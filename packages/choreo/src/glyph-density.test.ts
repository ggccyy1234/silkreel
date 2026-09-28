import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { decodeAlpha } from './decode'
import { boardModel } from '../test/helpers'

const BOARDS = [
  'StickHub.kicad_pcb',
  'ecc83-pp.kicad_pcb',
  'glasgow.kicad_pcb',
  'icebreaker.kicad_pcb',
  'kit-dev-coldfire-xilinx_5213.kicad_pcb',
  'video.kicad_pcb'
]

/** longest cyclic run of steps where nothing is visible on the decode grid */
function longestDarkRun(lit: boolean[]): number {
  const anchor = lit.indexOf(true)
  if (anchor < 0) return lit.length
  let best = 0
  let run = 0
  for (let i = 1; i <= lit.length; i++) {
    if (lit[(anchor + i) % lit.length] === false) {
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
    it(`${name} never goes dark for more than 2 consecutive steps`, () => {
      const tl = compileTimeline(boardModel(name), {
        style: 'glyph',
        knobs: {},
        seed: 42,
        duration: 'auto',
        output: { width: 1080, height: 1350, fps: 15 }
      })
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      const lit: boolean[] = []
      for (let s = 0; s < tl.steps; s++) {
        lit.push(
          tl.placements.some((p) => decodeAlpha(s, p.inStep, p.outStep, p.pattern, tl.steps) > 0.01) ||
            tl.ghost.bins.some((b) => decodeAlpha(s, b.inStep, b.outStep, b.pattern, tl.steps) > 0.01)
        )
      }
      const darkCount = lit.filter((v) => !v).length
      const run = longestDarkRun(lit)
      expect(lit[0], 'step 0 must be lit — A holds across the wrap').toBe(true)
      expect(run, `${name}: ${run} consecutive dark steps`).toBeLessThanOrEqual(2)
      // dead air stays a garnish, not a beat: under a sixth of the loop
      expect(darkCount / tl.steps).toBeLessThanOrEqual(1 / 6)
    })
  }
})
