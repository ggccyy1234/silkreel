import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import { buildCast } from './glyphs'
import { makeRng } from './rng'
import type { FilmConfig, GlyphTimeline } from './index'
import type { BoardModel } from '@silk-reel/ingest'
import { boardModel } from '../test/helpers'

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

// icebreaker: real silk words survive text hygiene (ecc83-pp is all refdes)
const board = () => boardModel('icebreaker.kicad_pcb')

function compile(board: BoardModel, overrides: Partial<FilmConfig> = {}): GlyphTimeline {
  const tl = compileTimeline(board, cfg(overrides))
  if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
  return tl
}

describe('knobs', () => {
  it('density scales the package cast size', () => {
    // cast size lives in buildCast — the timeline's cast is trimmed to used glyphs
    const sparse = buildCast(board(), 0.5, true, makeRng(42, 'cast'))
    const dense = buildCast(board(), 1.5, true, makeRng(42, 'cast'))
    const pk = (r: typeof sparse) => r.cast.filter((g) => g.kind === 'package').length
    expect(pk(dense)).toBeGreaterThan(pk(sparse))
  })

  it('texts=0 removes text glyphs; texts=1 includes them', () => {
    // the knob gates buildCast's silk-text extraction
    const off = buildCast(board(), 1, false, makeRng(42, 'cast'))
    const on = buildCast(board(), 1, true, makeRng(42, 'cast'))
    expect(off.cast.some((g) => g.kind === 'text')).toBe(false)
    expect(on.cast.some((g) => g.kind === 'text')).toBe(true)
  })

  it('unknown knobs are ignored rather than failing', () => {
    const tl = compile(board(), { knobs: { density: 1, mystery: 5 } as unknown as FilmConfig['knobs'] })
    expect(tl.cast.length).toBeGreaterThan(0)
  })

  it('out-of-range values clamp into bounds with a warning', () => {
    const tl = compile(board(), { knobs: { density: -2, texts: 7 } })
    const clamped = tl.warnings.filter((w) => w.code === 'knob-clamped')
    expect(clamped.some((w) => w.message.includes('density'))).toBe(true)
    expect(clamped.some((w) => w.message.includes('texts'))).toBe(true)
  })
})
