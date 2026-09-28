import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { decodeAlpha } from './decode'
import { buildCast } from './glyphs'
import { makeRng } from './rng'
import type { FilmConfig, GlyphTimeline } from './types'
import type { BoardModel } from '@silk-reel/ingest'
import { boardModel } from '../test/helpers'
import { syntheticBoardWithFootprints } from '../test/synthetic'
import { makeSyntheticBoard } from '../test/synthetic'

const BOARDS = [
  'ecc83-pp.kicad_pcb',
  'kit-dev-coldfire-xilinx_5213.kicad_pcb',
  'video.kicad_pcb',
  'StickHub.kicad_pcb',
  'icebreaker.kicad_pcb',
  'glasgow.kicad_pcb'
]

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

function compile(board: BoardModel, overrides: Partial<FilmConfig> = {}): GlyphTimeline {
  const tl = compileTimeline(board, cfg(overrides))
  if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
  return tl
}

/** is anything lit at this loop step (integer steps — the twos grid) */
function litAt(tl: GlyphTimeline, step: number): boolean {
  const on = (u: { inStep: number; outStep: number; pattern: number }): boolean =>
    decodeAlpha(step, u.inStep, u.outStep, u.pattern, tl.steps) > 0.01
  return tl.placements.some(on) || tl.ghost.bins.some(on)
}

/** longest cyclic run of steps where nothing is visible */
function longestDarkRun(tl: GlyphTimeline): number {
  const lit: boolean[] = []
  for (let s = 0; s < tl.steps; s++) lit.push(litAt(tl, s))
  const anchor = lit.indexOf(true)
  if (anchor < 0) return tl.steps
  let best = 0
  let run = 0
  for (let i = 1; i <= tl.steps; i++) {
    if (lit[(anchor + i) % tl.steps] === false) {
      run++
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

describe('composeFilm cast', () => {
  it('extracts package, text and mark glyphs from a real board', () => {
    // icebreaker carries real silk words (PMOD, FLASH, RGBLED) — ecc83-pp's
    // texts are all refdes, which text hygiene rejects
    const tl = compile(boardModel('icebreaker.kicad_pcb'))
    const kinds = new Set(tl.cast.map((g) => g.kind))
    expect(kinds.has('package')).toBe(true)
    expect(kinds.has('text')).toBe(true)
    expect(kinds.has('mark')).toBe(true)
    const ids = new Set(tl.cast.map((g) => g.id))
    expect(ids.size).toBe(tl.cast.length)
    for (const g of tl.cast) {
      if (g.kind === 'text') expect(typeof g.text).toBe('string')
      else expect(g.strokes.length).toBeGreaterThan(0)
    }
  })

  it('keeps package glyphs unit-normalized and centered', () => {
    const tl = compile(boardModel('ecc83-pp.kicad_pcb'))
    for (const g of tl.cast.filter((g) => g.kind === 'package')) {
      let maxAbs = 0
      let minX = Infinity
      let maxX = -Infinity
      for (const s of g.strokes) {
        for (const p of s) {
          maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y))
          minX = Math.min(minX, p.x)
          maxX = Math.max(maxX, p.x)
        }
      }
      expect(maxAbs).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(Math.abs(minX + maxX)).toBeLessThan(0.05)
    }
  })

  it('warns when a board exposes too few package outlines', () => {
    const tl = compile(makeSyntheticBoard(40))
    expect(tl.warnings.some((w) => w.code === 'thin-cast')).toBe(true)
  })

  it('cast hints promote the listed refs and texts into the cast', () => {
    // compileTimeline's cast is trimmed to placed glyphs — the hint contract
    // lives in buildCast
    const { cast } = buildCast(boardModel('icebreaker.kicad_pcb'), 1, true, makeRng(42, 'cast'), {
      preferRefs: ['P1', 'J31'],
      preferTexts: ['iCEBreaker', 'FPGA']
    })
    const ids = cast.map((g) => g.id)
    expect(ids).toContain('pkg:P1')
    expect(ids).toContain('pkg:J31')
    expect(cast.some((g) => g.kind === 'text' && g.text === 'iCEBreaker')).toBe(true)
    expect(cast.some((g) => g.kind === 'text' && g.text === 'FPGA')).toBe(true)
  })

  it('cast hints that miss produce a warning, not an error', () => {
    const tl = compile(boardModel('ecc83-pp.kicad_pcb'), {
      cast: { preferRefs: ['NOPE99'], preferTexts: ['NOT_A_LABEL'] }
    })
    const misses = tl.warnings.filter((w) => w.code === 'cast-hint-miss')
    expect(misses.length).toBe(2)
    expect(tl.cast.length).toBeGreaterThan(0)
  })

  it('rejects malformed cast hints', () => {
    expect(() =>
      compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ cast: { hero: ['U1'] } as unknown as NonNullable<FilmConfig['cast']> }))
    ).toThrow(/cast/i)
    expect(() =>
      compileTimeline(
        boardModel('ecc83-pp.kicad_pcb'),
        cfg({ cast: { preferRefs: 'U1' } as unknown as NonNullable<FilmConfig['cast']> })
      )
    ).toThrow(/preferRefs/i)
  })

  it('embeds silkscreen labels inside package glyphs', () => {
    const tl = compile(boardModel('icebreaker.kicad_pcb'))
    const labelled = tl.cast.filter((g) => g.kind === 'package' && (g.labels?.length ?? 0) > 0)
    expect(labelled.length).toBeGreaterThan(0)
    for (const g of labelled) {
      for (const label of g.labels ?? []) {
        expect(label.text.length).toBeGreaterThan(0)
        expect(Math.abs(label.x)).toBeLessThanOrEqual(1.4)
        expect(Math.abs(label.y)).toBeLessThanOrEqual(1.4)
        expect(label.size).toBeGreaterThan(0)
      }
    }
  })
})

describe('placements', () => {
  for (const name of BOARDS) {
    for (const aspect of ['4:5', '16:9'] as const) {
      it(`${name} @ ${aspect}: every placement is one valid symmetry set with shared timing`, () => {
        const tl = compile(boardModel(name), { aspect })
        expect(tl.placements.length).toBeGreaterThan(0)
        for (const p of tl.placements) {
          const glyph = tl.cast.find((g) => g.id === p.glyphId)
          expect(glyph, `${p.glyphId} missing from cast`).toBeDefined()
          expect(p.atoms.length).toBeGreaterThanOrEqual(1)
          expect(p.atoms.length).toBeLessThanOrEqual(4)
          expect(p.tones.length).toBe(p.atoms.length)
          expect(p.inStep).toBeGreaterThanOrEqual(0)
          expect(p.inStep).toBeLessThan(tl.steps)
          expect(p.outStep).toBeGreaterThanOrEqual(0)
          expect(p.outStep).toBeLessThan(tl.steps)
          expect(p.pattern).toBeGreaterThanOrEqual(0)
          expect(p.pattern).toBeLessThan(6)
          expect(tl.formations[p.formation], `formation ${p.formation} missing`).toBeDefined()
          // the true copy is first and unflipped; every off-axis atom has a
          // symmetry twin (mirror across Y, or the rot2 180° partner)
          expect(p.atoms[0]?.flipX).toBeFalsy()
          expect(p.atoms[0]?.flipY).toBeFalsy()
          for (const a of p.atoms) {
            if (Math.abs(a.x) < 1e-9) continue
            const twin = p.atoms.some(
              (b) =>
                b !== a &&
                Math.abs(b.x + a.x) < 1e-9 &&
                (Math.abs(b.y - a.y) < 1e-9 || Math.abs(b.y + a.y) < 1e-9)
            )
            expect(twin, `atom (${a.x.toFixed(2)},${a.y.toFixed(2)}) lacks a symmetry twin`).toBe(true)
          }
          // text ornament: reflections ride at 0.45 under the true copy's 0.9
          if (glyph?.kind === 'text' && p.atoms.length > 1) {
            expect(p.tones[0]).toBeCloseTo(0.9, 9)
            for (const t of p.tones.slice(1)) expect(t).toBeCloseTo(0.45, 9)
          }
        }
      })

      it(`${name} @ ${aspect}: step 0 is lit and no run of 3+ empty steps exists`, () => {
        const tl = compile(boardModel(name), { aspect })
        expect(tl.steps).toBe(168)
        expect(litAt(tl, 0), 'the seam mark must be lit at step 0').toBe(true)
        const run = longestDarkRun(tl)
        expect(run, `longest dark run is ${run} steps`).toBeLessThanOrEqual(2)
      })

      it(`${name} @ ${aspect}: placements decode inside their formation's arc window`, () => {
        const tl = compile(boardModel(name), { aspect })
        const ids = tl.formations.map((f) => f.id)
        // fixed arc: sparse A, dense B, quad climax, ghost, marks residue
        expect(ids.length).toBe(5)
        expect(['orbit', 'marks']).toContain(ids[0])
        expect(['columns', 'ring']).toContain(ids[1])
        expect(ids[2]).toBe('quad')
        expect(ids[3]).toBe('ghost')
        expect(ids[4]).toBe('marks')
        for (const f of tl.formations) {
          expect(f.startPhase).toBeGreaterThanOrEqual(0)
          expect(f.endPhase).toBeLessThanOrEqual(1)
          expect(f.endPhase).toBeGreaterThan(f.startPhase)
        }
        for (let i = 1; i < tl.formations.length; i++) {
          const prev = tl.formations[i - 1]
          const cur = tl.formations[i]
          expect(cur !== undefined && prev !== undefined && cur.startPhase > prev.startPhase).toBe(true)
        }
        for (const p of tl.placements) {
          const f = tl.formations[p.formation]
          if (f === undefined) continue
          // the seam mark wraps the loop on purpose — its inStep sits in D's band
          const wraps = p.outStep < p.inStep
          if (!wraps) {
            expect(p.inStep).toBeGreaterThanOrEqual(f.startPhase * tl.steps - 1e-9)
            expect(p.inStep).toBeLessThanOrEqual(f.endPhase * tl.steps + 1e-9)
            expect(p.outStep).toBeLessThanOrEqual(f.endPhase * tl.steps + 1e-9)
          }
        }
        for (const b of tl.ghost.bins) {
          const f = tl.formations[3]
          expect(f === undefined || b.inStep >= f.startPhase * tl.steps - 1e-9).toBe(true)
        }
        // glints target support placements inside their own hold
        for (const g of tl.glints) {
          const p = tl.placements[g.placement]
          expect(p).toBeDefined()
          expect(p?.role).toBe('support')
          expect(g.step).toBeGreaterThanOrEqual(0)
          expect(g.step).toBeLessThan(tl.steps)
        }
      })
    }
  }

  it('is deterministic for a fixed seed', () => {
    const a = compile(boardModel('glasgow.kicad_pcb'))
    const b = compile(boardModel('glasgow.kicad_pcb'))
    expect(JSON.stringify(a.placements)).toBe(JSON.stringify(b.placements))
    expect(JSON.stringify(a.ghost)).toBe(JSON.stringify(b.ghost))
  })

  it('board-seeded plans vary across the fixture set', () => {
    const plans = new Set<string>()
    for (const name of BOARDS) {
      const tl = compile(boardModel(name))
      plans.add(tl.formations.map((f) => f.id).join(','))
    }
    expect(plans.size).toBeGreaterThan(1)
  })

  it('keeps atoms finite and positive-scale everywhere', () => {
    const tl = compile(syntheticBoardWithFootprints(10))
    for (const p of tl.placements) {
      for (const a of p.atoms) {
        expect(Number.isFinite(a.x)).toBe(true)
        expect(Number.isFinite(a.y)).toBe(true)
        expect(Number.isFinite(a.rot)).toBe(true)
        expect(a.scale).toBeGreaterThan(0)
      }
    }
  })
})
