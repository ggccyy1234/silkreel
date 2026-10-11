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
      // the fixed three-act score: spine, pillars, frame — sorted by startPhase
      expect([...ids].sort()).toEqual(['frame', 'pillars', 'spine'])
      for (const f of tl.formations) {
        expect(f.endPhase).toBeGreaterThan(f.startPhase)
      }
      // the frame act is the climax — its window is lit, and the hero stands in it
      const frame = tl.formations.find((f) => f.id === 'frame')
      expect(frame).toBeDefined()
      if (frame === undefined) return
      const start = Math.round(frame.startPhase * tl.steps)
      const end = Math.round(frame.endPhase * tl.steps)
      const lit = tl.placements.filter((p) => {
        for (let s = start; s < end; s++) {
          if (decodeAlpha(s % tl.steps, p.inStep, p.outStep, p.pattern, tl.steps) > 0.05) return true
        }
        return false
      })
      expect(lit.length).toBeGreaterThan(0)
      // the climax crowns one hero — an accent, not a flood
      const heroes = tl.placements.filter((p) => p.role === 'hero')
      expect(heroes.length).toBeGreaterThan(0)
      expect(heroes.length).toBeLessThanOrEqual(4)
      const heroLit = heroes.some((p) => {
        for (let s = start; s < end; s++) {
          if (decodeAlpha(s % tl.steps, p.inStep, p.outStep, p.pattern, tl.steps) > 0.05) return true
        }
        return false
      })
      expect(heroLit).toBe(true)
    })
  }

  it('different seeds change the placement score', () => {
    const board = boardModel('glasgow.kicad_pcb')
    const sig = (seed: number): string => {
      const tl = compileTimeline(board, {
        style: 'glyph',
        knobs: {},
        seed,
        duration: 'auto',
        output: { width: 1080, height: 1350, fps: 15 }
      })
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      return JSON.stringify(tl.placements.map((p) => [p.glyphId, p.inStep, p.outStep]))
    }
    const seen = new Set([1, 2, 3, 4, 5, 6].map(sig))
    expect(seen.size).toBeGreaterThan(1)
  })
})
