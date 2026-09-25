import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import { boardModel } from '../../choreo/test/helpers'
import { compileStudioFilm, DEFAULT_KNOBS } from './film-config'

describe('preview and export identity', () => {
  it('exports the resolved preview seed without changing the null-seed control', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const config = { knobs: DEFAULT_KNOBS, seed: null, duration: 167 / 15, output: { width: 1080, height: 1350, fps: 15 } }
    const preview = compileStudioFilm(board, config)

    expect(config.seed).toBeNull()
    expect(preview.config.seed).toBe(preview.timeline.seedUsed)
    expect(JSON.stringify(compileTimeline(board, preview.config))).toBe(JSON.stringify(preview.timeline))
  })
})
