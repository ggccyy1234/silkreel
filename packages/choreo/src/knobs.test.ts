import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index'
import type { FilmConfig } from './index'
import { boardModel } from '../test/helpers'

function cfg(overrides: Partial<FilmConfig> = {}): FilmConfig {
  return {
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 15 },
    ...overrides
  }
}

const board = () => boardModel('ecc83-pp.kicad_pcb')

describe('knobs', () => {
  it('density scales the package cast size', () => {
    const sparse = compileTimeline(board(), cfg({ knobs: { density: 0.5 } }))
    const dense = compileTimeline(board(), cfg({ knobs: { density: 1.5 } }))
    const pk = (tl: typeof sparse) => tl.cast.filter((g) => g.kind === 'package').length
    expect(pk(dense)).toBeGreaterThan(pk(sparse))
  })

  it('texts=0 removes text glyphs; texts=1 includes them', () => {
    const off = compileTimeline(board(), cfg({ knobs: { texts: 0 } }))
    const on = compileTimeline(board(), cfg({ knobs: { texts: 1 } }))
    expect(off.cast.some((g) => g.kind === 'text')).toBe(false)
    expect(on.cast.some((g) => g.kind === 'text')).toBe(true)
  })

  it('unknown knobs are ignored rather than failing', () => {
    const tl = compileTimeline(
      board(),
      cfg({ knobs: { density: 1, mystery: 5 } as unknown as FilmConfig['knobs'] })
    )
    expect(tl.cast.length).toBeGreaterThan(0)
  })

  it('out-of-range values clamp into bounds with a warning', () => {
    const tl = compileTimeline(board(), cfg({ knobs: { density: -2, texts: 7 } }))
    const clamped = tl.warnings.filter((w) => w.code === 'knob-clamped')
    expect(clamped.some((w) => w.message.includes('density'))).toBe(true)
    expect(clamped.some((w) => w.message.includes('texts'))).toBe(true)
  })
})
