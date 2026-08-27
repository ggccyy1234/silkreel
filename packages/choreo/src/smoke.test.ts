import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { boardModel } from '../test/helpers'

describe('choreo package smoke', () => {
  it('compiles a real board to a directed timeline', () => {
    const tl = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), {
      actOrder: [],
      knobs: {},
      seed: 42,
      duration: 'auto',
      output: { width: 1080, height: 1350, fps: 15 }
    })
    expect(tl.cast.length).toBeGreaterThan(0)
    expect(tl.shots.length).toBe(9)
    expect(tl.shots.some((shot) => shot.tracks.length > 0)).toBe(true)
  })
})
