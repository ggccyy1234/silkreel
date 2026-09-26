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
      const ids = tl.formations.map((f) => f.id)
      // the loop opens and closes on the same marks residue; 5–7 middles
      expect(ids[0]).toBe('marks')
      expect(ids.at(-1)).toBe('marks')
      expect(ids.length).toBeGreaterThanOrEqual(7)
      expect(ids.length).toBeLessThanOrEqual(9)
      for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1])
      // something is visible during the longest (climax) hold
      const climax = tl.formations.reduce((a, b) =>
        b.endPhase - b.startPhase > a.endPhase - a.startPhase ? b : a
      )
      const midClimax = (climax.startPhase + climax.endPhase) / 2
      const lit = tl.tracks.reduce(
        (n, t) => n + sampleTrack(t, midClimax).filter((a) => a.alpha > 0.05).length,
        0
      )
      expect(lit).toBeGreaterThan(0)
    })
  }

  it('different seeds plan different formation sequences', () => {
    const seq = (seed: number): string => {
      const tl = compileTimeline(boardModel('glasgow.kicad_pcb'), {
        style: 'glyph',
        knobs: {},
        seed,
        duration: 'auto',
        output: { width: 1080, height: 1350, fps: 15 }
      })
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      return tl.formations.map((f) => f.id).join(',')
    }
    expect(seq(1)).not.toBe(seq(2))
  })
})
