import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { decodeAlpha } from './decode'
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
      // 11.2s auto duration → 168 decode steps; 168 output frames at fps 15
      expect(tl.totalFrames).toBe(168)
      expect(tl.steps).toBe(168)
      expect(tl.cast.length).toBeGreaterThan(0)
      // every cast member is placed at least once — dead cast was trimmed
      for (const g of tl.cast) {
        expect(tl.placements.some((p) => p.glyphId === g.id), `${g.id} never placed`).toBe(true)
      }
      const ids = tl.formations.map((f) => f.id)
      // fixed arc: seeded sparse, seeded dense, quad climax, ghost, marks residue
      expect(ids.length).toBe(5)
      expect(['orbit', 'marks']).toContain(ids[0])
      expect(['columns', 'ring']).toContain(ids[1])
      expect(ids[2]).toBe('quad')
      expect(ids[3]).toBe('ghost')
      expect(ids[4]).toBe('marks')
      // something is visible during the climax hold
      const climax = tl.formations[2]
      expect(climax).toBeDefined()
      if (climax === undefined) return
      const midStep = Math.round(((climax.startPhase + climax.endPhase) / 2) * tl.steps)
      const lit = tl.placements.filter(
        (p) => decodeAlpha(midStep, p.inStep, p.outStep, p.pattern, tl.steps) > 0.05
      )
      expect(lit.length).toBeGreaterThan(0)
      // the climax crowns one hero — an accent, not a flood
      const heroes = lit.filter((p) => p.role === 'hero').length
      if (tl.cast.some((g) => g.kind === 'package')) {
        expect(heroes).toBeGreaterThan(0)
        expect(heroes).toBeLessThanOrEqual(Math.max(4, lit.length / 4))
      }
    })
  }

  it('different seeds plan different formation sequences', () => {
    const board = boardModel('glasgow.kicad_pcb')
    const seq = (seed: number): string => {
      const tl = compileTimeline(board, {
        style: 'glyph',
        knobs: {},
        seed,
        duration: 'auto',
        output: { width: 1080, height: 1350, fps: 15 }
      })
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      return tl.formations.map((f) => f.id).join(',')
    }
    const seen = new Set([1, 2, 3, 4, 5, 6].map(seq))
    expect(seen.size).toBeGreaterThan(1)
  })
})
