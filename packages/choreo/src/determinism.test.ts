import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import type { FilmConfig } from './index'
import { boardModel } from '../test/helpers'
import { syntheticBoardWithFootprints } from '../test/synthetic'

function cfg(overrides: Partial<FilmConfig> = {}): FilmConfig {
  return {
    style: 'glyph',
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 15 },
    ...overrides
  }
}

function sha256Of(tl: ReturnType<typeof compileTimeline>): string {
  return createHash('sha256').update(JSON.stringify(tl)).digest('hex')
}

describe('seeded determinism', () => {
  it('same seed compiles byte-identical timelines', () => {
    const a = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 42 }))
    const b = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 42 }))
    expect(sha256Of(a)).toBe(sha256Of(b))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('different seeds diverge', () => {
    const a = sha256Of(compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 42 })))
    const b = sha256Of(compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 43 })))
    expect(a).not.toBe(b)
  })

  it('null seed produces distinct self-consistent timelines', () => {
    const digests = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const tl = compileTimeline(syntheticBoardWithFootprints(12), cfg({ seed: null }))
      if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
      digests.add(sha256Of(tl))
      expect(tl.cast.length).toBeGreaterThan(0)
      expect(tl.formations[0]?.startPhase).toBe(0)
      expect(tl.formations.at(-1)?.endPhase).toBeLessThanOrEqual(1)
    }
    expect(digests.size).toBe(3)
  })
})

describe('degenerate-but-legal configs', () => {
  it('out-of-range density clamps with a warning', () => {
    const tl = compileTimeline(syntheticBoardWithFootprints(8), cfg({ knobs: { density: 9 } }))
    expect(tl.warnings.some((w) => w.code === 'knob-clamped' && w.message.includes('density'))).toBe(true)
  })

  it('duration below the 6s floor clamps with a warning', () => {
    const tl = compileTimeline(syntheticBoardWithFootprints(8), cfg({ duration: 3 }))
    expect(tl.durationSeconds).toBeGreaterThanOrEqual(6 - 1e-9)
    expect(tl.warnings.some((w) => w.code === 'duration-clamped')).toBe(true)
    expect(tl.totalFrames).toBe(Math.round(tl.durationSeconds * tl.fps))
  })

  it('out-of-domain configs are rejected typed', () => {
    expect(() => compileTimeline(syntheticBoardWithFootprints(4), cfg({ duration: -4 }))).toThrow(/duration/i)
    expect(() =>
      compileTimeline(syntheticBoardWithFootprints(4), cfg({ output: { width: 0, height: 1350, fps: 15 } }))
    ).toThrow(/width|output/i)
    expect(() =>
      compileTimeline(syntheticBoardWithFootprints(4), cfg({ knobs: { density: 'dense' as unknown as number } }))
    ).toThrow(/density/i)
  })
})
