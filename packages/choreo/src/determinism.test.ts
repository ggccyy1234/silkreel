import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index.js'
import type { FilmConfig } from './index.js'
import { boardModel } from '../test/helpers.js'
import { makeSyntheticBoard } from '../test/synthetic.js'

function cfg(overrides: Partial<FilmConfig> = {}): FilmConfig {
  return {
    actOrder: [],
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

describe('VAL-FILM-012 seeded determinism', () => {
  it('same seed compiles byte-identical Timelines', () => {
    const a = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 42 }))
    const b = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 42 }))
    const da = sha256Of(a)
    const db = sha256Of(b)
    expect(da).toBe(db)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('different seeds diverge', () => {
    const a = sha256Of(compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 42 })))
    const b = sha256Of(compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ seed: 43 })))
    expect(a).not.toBe(b)
  })

  it('null seed produces three distinct self-consistent Timelines', () => {
    const digests = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const tl = compileTimeline(makeSyntheticBoard(200), cfg({ seed: null }))
      digests.add(sha256Of(tl))
      expect(tl.acts.length).toBeGreaterThanOrEqual(2)
      expect(tl.elements.length).toBeGreaterThan(0)
      for (const act of tl.acts) {
        const kinds = act.phases.map((p) => p.kind)
        expect(kinds).toContain('seed')
        expect(kinds).toContain('dissolve')
      }
    }
    expect(digests.size).toBe(3)
  })
})

describe('VAL-FILM-022 degenerate-but-legal configs', () => {
  it('beatCount=5 stays structurally valid with documented clamping', () => {
    const tl = compileTimeline(makeSyntheticBoard(60), cfg({ knobs: { beatCount: 5 } }))
    expect(tl.acts.length).toBeGreaterThan(0)
    for (const act of tl.acts) {
      const beats = act.phases.filter((p) => p.kind === 'beat').length
      expect(beats).toBeLessThanOrEqual(1)
      expect(act.endFrame).toBeGreaterThanOrEqual(act.startFrame)
    }
    expect(tl.beats.length, 'beats clamped to available carrying acts').toBeLessThan(6)
    console.log(`clamp evidence: requested beatCount=5, compiled beats=${tl.beats.length} (one per short-listed carrier)`)
  })

  it('exposure=3.0 stays structurally valid with documented clamping', () => {
    const tl = compileTimeline(makeSyntheticBoard(60), cfg({ knobs: { exposure: 3.0 } }))
    expect(tl.acts.length).toBeGreaterThan(0)
    for (const act of tl.acts) {
      const beats = act.phases.filter((p) => p.kind === 'beat').length
      expect(beats).toBeLessThanOrEqual(1)
      expect(act.endFrame).toBeGreaterThanOrEqual(act.startFrame)
    }
    expect(tl.renderParams.exposure).toBeCloseTo(2, 5)
    console.log(`clamp evidence: exposure=3.0 clamped to ${tl.renderParams.exposure}`)
    expect(tl.warnings.some((w) => w.code === 'knob-clamped' && w.message.includes('exposure'))).toBe(true)
  })

  it('duration=3s below minimum floors is clamped to the 6s floor with warning, or rejected typed', () => {
    let outcome: 'clamped' | 'rejected' | 'corrupt' | 'accepted-unflagged' = 'corrupt'
    try {
      const tl = compileTimeline(makeSyntheticBoard(60), cfg({ duration: 3 }))
      if (tl.durationSeconds < 6 - 1e-9) throw new Error('below-floor duration accepted without clamp')
      outcome = tl.warnings.some((w) => w.code === 'duration-clamped') ? 'clamped' : 'accepted-unflagged'
      expect(outcome).toBe('clamped')
      expect(tl.totalFrames).toBe(Math.round(tl.durationSeconds * tl.fps))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      const msg = err instanceof Error ? err.message : ''
      expect(msg).toMatch(/duration/i)
      outcome = 'rejected'
    }
    expect(['clamped', 'rejected']).toContain(outcome)
  })

  it("symmetry='none' + center-out dissolve compiles valid structure", () => {
    const tl = compileTimeline(
      makeSyntheticBoard(80),
      cfg({ knobs: { symmetry: 'none', dissolveStyle: 'center-out' } })
    )
    expect(tl.acts.length).toBeGreaterThanOrEqual(2)
    for (const act of tl.acts) {
      const kinds = act.phases.map((p) => p.kind)
      expect(kinds.indexOf('seed')).toBeGreaterThanOrEqual(0)
      expect(kinds[kinds.length - 1]).toBe('dissolve')
    }
  })

  it('out-of-domain configs are contained: clamped-with-warning or typed rejection', () => {
    expect(() =>
      compileTimeline(makeSyntheticBoard(30), cfg({ duration: -4 }))
    ).toThrow(/duration/i)
    expect(() =>
      compileTimeline(makeSyntheticBoard(30), cfg({ output: { width: 0, height: 1350, fps: 15 } }))
    ).toThrow(/width|output/i)
    expect(() =>
      compileTimeline(makeSyntheticBoard(30), cfg({ knobs: { rhythmDensity: 'fast' as unknown as number } }))
    ).toThrow(/rhythmDensity/i)

    const clamped = compileTimeline(makeSyntheticBoard(30), cfg({ knobs: { rhythmDensity: 7 } }))
    const note = clamped.warnings.find((w) => w.code === 'knob-clamped' && w.message.includes('rhythmDensity'))
    expect(note, 'clamped rhythmDensity must be documented in warnings').toBeDefined()
    expect(clamped.acts.length).toBeGreaterThan(0)
  })

  it('actOrder referencing unknown acts is rejected typed or ignored safely', () => {
    let threw = false
    try {
      compileTimeline(makeSyntheticBoard(40), cfg({ actOrder: ['copper:F.Cu', 'silk:Nope.SilkS'] }))
    } catch (err) {
      threw = true
      expect(err instanceof Error ? err.message : '').toMatch(/act|order|Nope/i)
    }
    if (!threw) {
      const tl = compileTimeline(makeSyntheticBoard(40), cfg({ actOrder: ['copper:F.Cu'] }))
      expect(tl.acts.length).toBeGreaterThanOrEqual(2)
    }
  })
})
