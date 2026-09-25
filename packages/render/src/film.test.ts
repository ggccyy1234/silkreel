import './test-recorder.js'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig, GlyphTimeline, TraceTimeline } from '@silk-reel/choreo'
import type { BoardModel } from '@silk-reel/ingest'
import { buildScene, drawFrame } from './film.js'
import { asCtx, currentRecorder, RecordingCtx } from './test-recorder.js'
import { boardModel } from '../../choreo/test/helpers.js'

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

function compiled(board: BoardModel, overrides: Partial<FilmConfig> = {}): GlyphTimeline {
  const tl = compileTimeline(board, cfg(overrides))
  if (tl.style !== 'glyph') throw new Error('expected a glyph timeline')
  return tl
}

function callsOf(method: string) {
  return currentRecorder().calls.filter((c) => c.method === method)
}

describe('buildScene', () => {
  it('builds a render entry for every cast glyph', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const scene = buildScene(compiled(board))
    for (const glyph of compiled(board).cast) {
      const entry = scene.glyphs.get(glyph.id)
      expect(entry, `missing scene entry for ${glyph.id}`).toBeDefined()
      if (glyph.kind === 'text') expect(entry?.text).toBe(glyph.text)
      else expect(entry?.path).toBeDefined()
    }
  })
})

describe('drawFrame', () => {
  const board = boardModel('ecc83-pp.kicad_pcb')

  it('clears to black and inks in pure white', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    drawFrame(asCtx(currentRecorder()), timeline, scene, Math.floor(timeline.totalFrames * 0.4))
    const fill = callsOf('fillRect')[0]
    expect(fill).toBeDefined()
    const props = currentRecorder().props
    expect(props['strokeStyle']).toBe('#ffffff')
    expect(props['fillStyle']).toBe('#ffffff')
  })

  it('draws nothing at the loop point (breath = 0)', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    const drawn = drawFrame(asCtx(currentRecorder()), timeline, scene, 0)
    expect(drawn).toBe(0)
    expect(callsOf('stroke').length).toBe(0)
    expect(callsOf('fillText').length).toBe(0)
  })

  it('draws atoms during formation holds', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    const drawn = drawFrame(asCtx(currentRecorder()), timeline, scene, Math.floor(timeline.totalFrames * 0.8))
    expect(drawn).toBeGreaterThan(0)
    expect(callsOf('stroke').length + callsOf('fillText').length).toBeGreaterThan(0)
  })

  it('mirrored atoms render with a flipped transform', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    drawFrame(asCtx(currentRecorder()), timeline, scene, Math.floor(timeline.totalFrames * 0.6))
    const flips = callsOf('scale').filter((c) => (c.args[0] as number) < 0 || (c.args[1] as number) < 0)
    expect(flips.length).toBeGreaterThan(0)
  })

  it('uses a constant screen-space hairline regardless of glyph scale', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    drawFrame(asCtx(currentRecorder()), timeline, scene, Math.floor(timeline.totalFrames * 0.8))
    // lineWidth is set in glyph space as INK_PX/sizePx — the recorded widths
    // must vary with scale (bigger glyph -> smaller glyph-space width)
    const widths = callsOf('set:lineWidth').map((c) => c.args[0] as number)
    expect(widths.length).toBeGreaterThan(1)
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths))
  })

  it('draws embedded labels inside package outlines', () => {
    const timeline = compiled(boardModel('icebreaker.kicad_pcb'), {
      cast: { preferRefs: ['P1', 'SW1', 'SW2', 'J31', 'J33', 'J34'] }
    })
    const labelled = timeline.cast.filter((g) => (g.labels?.length ?? 0) > 0)
    expect(labelled.length).toBeGreaterThan(0)
    const scene = buildScene(timeline)
    drawFrame(asCtx(currentRecorder()), timeline, scene, Math.floor(timeline.totalFrames * 0.8))
    const texts = callsOf('fillText').map((c) => c.args[0])
    const labelTexts = new Set(labelled.flatMap((g) => (g.labels ?? []).map((l) => l.text)))
    expect(texts.some((t) => labelTexts.has(t as string))).toBe(true)
  })

  it('handles an empty cast without throwing', () => {
    const timeline = compiled(boardModel('video.kicad_pcb'), { seed: 7 })
    const scene = buildScene(timeline)
    for (const frame of [0, 5, timeline.totalFrames - 1]) {
      expect(() => drawFrame(asCtx(new RecordingCtx()), timeline, scene, frame)).not.toThrow()
    }
  })

  it('fills the palette background and draws nothing for an empty trace scene', () => {
    const compiled = compileTimeline(board, cfg({ style: 'trace' }))
    if (compiled.style !== 'trace') throw new Error('expected a trace timeline')
    const timeline: TraceTimeline = {
      ...compiled,
      scene: { ...compiled.scene, outline: [], layers: [], pads: [], vias: [], drills: [], zones: [], silkStrokes: [], texts: [] }
    }
    const scene = buildScene(timeline)
    const rec = currentRecorder()
    const drawn = drawFrame(asCtx(rec), timeline, scene, 10)
    expect(drawn).toBe(0)
    const fill = callsOf('fillRect')[0]
    expect(fill?.args).toEqual([0, 0, timeline.width, timeline.height])
    const bgSet = rec.calls.filter((c) => c.method === 'set:fillStyle').map((c) => c.args[0])
    expect(bgSet).toContain(timeline.palette.bg)
    expect(callsOf('stroke').length).toBe(0)
    expect(callsOf('fillText').length).toBe(0)
  })
})
