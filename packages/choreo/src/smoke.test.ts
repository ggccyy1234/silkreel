import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { sampleTrack } from './composer'
import { boardModel } from '../test/helpers'

describe('choreo package smoke', () => {
  for (const name of [
    'ecc83-pp.kicad_pcb',
    'StickHub.kicad_pcb',
    'video.kicad_pcb',
    'icebreaker.kicad_pcb',
    'glasgow.kicad_pcb'
  ]) {
    it(`compiles ${name} to a looping glyph timeline`, () => {
      const tl = compileTimeline(boardModel(name), {
        style: 'glyph',
        knobs: {},
        seed: 42,
        duration: 'auto',
        output: { width: 1080, height: 1350, fps: 15 }
      })
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      expect(tl.totalFrames).toBeGreaterThan(0)
      expect(tl.cast.length).toBeGreaterThan(0)
      expect(tl.tracks.length).toBe(tl.cast.filter((g) => tl.tracks.some((t) => t.glyphId === g.id)).length)
      expect(tl.formations.map((f) => f.id)).toEqual([
        'marks',
        'spine',
        'totem',
        'marks',
        'columns',
        'marks',
        'ring',
        'quad',
        'marks'
      ])
      // something is visible during at least one hold
      const quad = tl.formations.at(-2)
      const midQuad = ((quad?.startPhase ?? 0.7) + (quad?.endPhase ?? 0.9)) / 2
      const lit = tl.tracks.reduce(
        (n, t) => n + sampleTrack(t, midQuad).filter((a) => a.alpha > 0.05).length,
        0
      )
      expect(lit).toBeGreaterThan(0)
    })
  }
})
