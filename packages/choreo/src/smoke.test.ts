import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index.js'
import { boardModel } from '../test/helpers.js'

describe('choreo package smoke', () => {
  it('compiles a real board to a timeline with acts and elements', () => {
    const tl = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), {
      actOrder: [],
      knobs: {},
      seed: 42,
      duration: 'auto',
      output: { width: 1080, height: 1350, fps: 15 }
    })
    expect(tl.acts.length).toBeGreaterThan(0)
    expect(tl.elements.length).toBeGreaterThan(0)
  })
})
