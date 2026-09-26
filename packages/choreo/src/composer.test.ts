import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { sampleTrack } from './composer'
import type { AtomState, FilmConfig, GlyphTimeline } from './types'
import type { BoardModel } from '@silk-reel/ingest'
import { boardModel } from '../test/helpers'
import { syntheticBoardWithFootprints } from '../test/synthetic'
import { makeSyntheticBoard } from '../test/synthetic'

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

function atomsAt(tl: GlyphTimeline, phase: number): AtomState[] {
  const out: AtomState[] = []
  for (const track of tl.tracks) out.push(...sampleTrack(track, phase))
  return out
}

/** every atom must have a mirror counterpart at (-x, y); atoms on the axis pair with themselves */
function assertMirrorBalanced(atoms: AtomState[], context: string): void {
  const eps = 1e-6
  const right = atoms.filter((a) => a.x > eps)
  const left = atoms.filter((a) => a.x < -eps)
  expect(left.length, `${context}: left/right atom counts differ`).toBe(right.length)
  for (const a of atoms) {
    if (Math.abs(a.x) <= eps) continue
    const twin = atoms.some(
      (b) => Math.abs(b.x + a.x) <= eps && Math.abs(b.y - a.y) <= eps
    )
    expect(twin, `${context}: atom at (${a.x.toFixed(3)},${a.y.toFixed(3)}) lacks a mirror twin`).toBe(true)
  }
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
    const tl = compile(boardModel('icebreaker.kicad_pcb'), {
      cast: { preferRefs: ['P1', 'J31'], preferTexts: ['iCEBreaker', 'FPGA'] }
    })
    const ids = tl.cast.map((g) => g.id)
    expect(ids).toContain('pkg:P1')
    expect(ids).toContain('pkg:J31')
    expect(tl.cast.some((g) => g.kind === 'text' && g.text === 'iCEBreaker')).toBe(true)
    expect(tl.cast.some((g) => g.kind === 'text' && g.text === 'FPGA')).toBe(true)
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

describe('composeFilm formations', () => {
  it('emits a planned formation arc with non-overlapping holds inside [0,1)', () => {
    const tl = compile(boardModel('ecc83-pp.kicad_pcb'))
    const ids = tl.formations.map((f) => f.id)
    // marks residue bookends the loop; 5–7 middles; nothing repeats in a row
    expect(ids[0]).toBe('marks')
    expect(ids.at(-1)).toBe('marks')
    expect(ids.length).toBeGreaterThanOrEqual(7)
    expect(ids.length).toBeLessThanOrEqual(9)
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1])
    expect(tl.formations.map((f) => f.beat)).toEqual(ids.map((_, i) => i))
    for (const f of tl.formations) {
      expect(f.startPhase).toBeGreaterThanOrEqual(0)
      expect(f.endPhase).toBeLessThanOrEqual(1)
      expect(f.endPhase).toBeGreaterThan(f.startPhase)
    }
    for (let i = 1; i < tl.formations.length; i++) {
      const prev = tl.formations[i - 1]
      const cur = tl.formations[i]
      expect(cur !== undefined && prev !== undefined && cur.startPhase > prev.endPhase).toBe(true)
    }
  })

  it('gives every track sorted knots inside [0,1)', () => {
    const tl = compile(boardModel('ecc83-pp.kicad_pcb'))
    expect(tl.tracks.length).toBeGreaterThan(0)
    for (const track of tl.tracks) {
      expect(track.knots.length).toBeGreaterThanOrEqual(2)
      for (let i = 1; i < track.knots.length; i++) {
        const prev = track.knots[i - 1]
        const cur = track.knots[i]
        expect(cur !== undefined && prev !== undefined && cur.phase >= prev.phase).toBe(true)
      }
      for (const k of track.knots) {
        expect(k.phase).toBeGreaterThanOrEqual(0)
        expect(k.phase).toBeLessThan(1)
        expect(k.atoms.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('sampleTrack', () => {
  it('is mirror-balanced at every sampled phase, including mid-transition', () => {
    const tl = compile(boardModel('video.kicad_pcb'))
    for (let i = 0; i < 200; i++) {
      const p = i / 200
      const atoms = atomsAt(tl, p).filter((a) => a.alpha > 0.01)
      if (atoms.length === 0) continue
      assertMirrorBalanced(atoms, `phase ${p.toFixed(3)}`)
    }
  })

  it('produces identical atom states at phase 0 and phase 1 (seamless loop)', () => {
    const tl = compile(boardModel('ecc83-pp.kicad_pcb'))
    for (const track of tl.tracks) {
      expect(sampleTrack(track, 1)).toEqual(sampleTrack(track, 0))
    }
    // and the film actually moves: ring-hold state differs from columns-hold
    const ring = atomsAt(tl, 0.78)
    const columns = atomsAt(tl, 0.6)
    expect(JSON.stringify(ring)).not.toBe(JSON.stringify(columns))
  })

  it('keeps atoms finite with sane alpha and scale everywhere', () => {
    const tl = compile(syntheticBoardWithFootprints(10))
    for (let i = 0; i < 64; i++) {
      for (const a of atomsAt(tl, i / 64)) {
        expect(Number.isFinite(a.x)).toBe(true)
        expect(Number.isFinite(a.y)).toBe(true)
        expect(Number.isFinite(a.rot)).toBe(true)
        expect(a.alpha).toBeGreaterThanOrEqual(0)
        expect(a.alpha).toBeLessThanOrEqual(1)
        expect(a.scale).toBeGreaterThan(0)
      }
    }
  })

  it('dims mid-transition so holds read as separate density waves', () => {
    const tl = compile(boardModel('ecc83-pp.kicad_pcb'))
    // midpoint of a transition bracket: alpha should dip below both endpoint levels
    const track = tl.tracks.find((t) => t.knots.some((k) => k.transit !== undefined))
    expect(track).toBeDefined()
    if (track === undefined) return
    const depart = track.knots.find((k) => k.transit !== undefined)
    const idx = depart === undefined ? -1 : track.knots.indexOf(depart)
    const next = track.knots[(idx + 1) % track.knots.length]
    if (depart === undefined || next === undefined) throw new Error('no transit bracket found')
    const mid = depart.phase + (((next.phase - depart.phase + 1) % 1) / 2)
    const peak0 = depart.atoms.reduce((s, a) => s + a.alpha, 0)
    const peak1 = next.atoms.reduce((s, a) => s + a.alpha, 0)
    const midSum = sampleTrack(track, ((mid % 1) + 1) % 1).reduce((s, a) => s + a.alpha, 0)
    if (peak0 > 0 && peak1 > 0) {
      expect(midSum).toBeLessThan(Math.max(peak0, peak1))
    }
  })
})
