import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../config'
import type { FilmConfig } from '../types'
import { compileTrace } from './index'
import { boardModel } from '../../test/helpers'

// regression guard only: pins the approved glasgow 4:5 schedule so later
// changes that drift the growth timings fail loudly. Not a quality claim.
describe('approved trace schedule', () => {
  const config: FilmConfig = {
    style: 'trace',
    aspect: '4:5',
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 30 }
  }
  const { scene } = compileTrace(boardModel('glasgow.kicad_pcb'), resolveConfig(config), 42)

  it('pins seg/pad counts and the earliest growth times', () => {
    const segCount = scene.layers.reduce((n, l) => n + l.segs.length / 7, 0)
    expect(segCount).toMatchInlineSnapshot(`4715`)
    expect(scene.pads.length).toMatchInlineSnapshot(`1149`)
    expect(scene.beats).toMatchInlineSnapshot(`
      {
        "fade": [
          0.96,
          1,
        ],
        "growth": [
          0.14,
          0.72,
        ],
        "hold": [
          0.82,
          0.96,
        ],
        "outline": [
          0,
          0.1,
        ],
        "pads": [
          0.05,
          0.24,
        ],
        "silk": [
          0.68,
          0.84,
        ],
        "zones": [
          0.6,
          0.76,
        ],
      }
    `)
    const t0s = scene.layers
      .flatMap((l) => l.segs.filter((_, i) => i % 7 === 5))
      .sort((a, b) => a - b)
      .slice(0, 5)
      .map((t) => Math.round(t * 1e4) / 1e4)
    expect(t0s).toMatchInlineSnapshot(`
      [
        0.14,
        0.1401,
        0.1402,
        0.1402,
        0.1403,
      ]
    `)
  })
})
