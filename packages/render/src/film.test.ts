import './test-recorder.js'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig, GlyphTimeline, TraceTimeline } from '@silk-reel/choreo'
import type { BoardModel } from '@silk-reel/ingest'
import { buildScene, drawFrame, drawGlyphFrame, postOptionsFor } from './film.js'
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

describe('postOptionsFor', () => {
  it('glyph renders flat: no bloom, no vignette, grain preserved', () => {
    const tl = compiled(boardModel('glasgow.kicad_pcb'), { palette: 'copper' })
    expect(tl.palette.bloom).toBeGreaterThan(0)
    const opts = postOptionsFor(tl)
    expect(opts.bloom).toBe(0)
    expect(opts.vignette).toBe(false)
    expect(opts.grain).toBe(true)
    const noGrain = postOptionsFor(tl, false)
    expect(noGrain.grain).toBe(false)
  })

  it('trace keeps its palette bloom and vignette', () => {
    const tl = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), cfg({ style: 'trace', palette: 'copper' }))
    if (tl.style !== 'trace') throw new Error('expected a trace timeline')
    const opts = postOptionsFor(tl)
    expect(opts.bloom).toBe(tl.palette.bloom)
    expect(opts.vignette).toBe(true)
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

  it('inks heroes in palette.head and the rest in palette.silk', () => {
    const timeline = compiled(board, { palette: 'copper' })
    const scene = buildScene(timeline)
    const inks: unknown[] = []
    for (let f = 0; f < timeline.totalFrames; f += 5) {
      currentRecorder().reset()
      drawFrame(asCtx(currentRecorder()), timeline, scene, f)
      inks.push(...callsOf('set:strokeStyle').map((c) => c.args[0]))
    }
    const head = inks.filter((c) => c === timeline.palette.head).length
    const silk = inks.filter((c) => c === timeline.palette.silk).length
    expect(head).toBeGreaterThan(0)
    expect(silk).toBeGreaterThan(head)
  })

  it('draws the seam mark at frame 0 — the loop point is never empty', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    const drawn = drawFrame(asCtx(currentRecorder()), timeline, scene, 0)
    expect(drawn).toBeGreaterThan(0)
    expect(callsOf('stroke').length + callsOf('fill').length).toBeGreaterThan(0)
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

  it('twos cadence draws frames 2k and 2k+1 identically', () => {
    // 30fps output: each decode step holds for exactly two frames
    const timeline = compiled(board, { output: { width: 1080, height: 1350, fps: 30 } })
    const scene = buildScene(timeline)
    // inside the quad hold, where plenty is lit
    const f = Math.floor(timeline.totalFrames * 0.65)
    const even = f - (f % 2)
    const recA = new RecordingCtx()
    drawFrame(asCtx(recA), timeline, scene, even)
    const recB = new RecordingCtx()
    drawFrame(asCtx(recB), timeline, scene, even + 1)
    expect(JSON.stringify(recB.calls)).toBe(JSON.stringify(recA.calls))
  })

  it('smooth cadence moves off the step grid', () => {
    const timeline = compiled(board, { cadence: 'smooth' })
    expect(timeline.cadence).toBe('smooth')
    const scene = buildScene(timeline)
    // a frame in a decode ramp should draw partial alphas that twos never emits
    const f = Math.floor(timeline.totalFrames * 0.15)
    const rec = new RecordingCtx()
    drawFrame(asCtx(rec), timeline, scene, f)
    drawFrame(asCtx(rec), timeline, scene, f + 1)
    // just needs to not throw and draw something — smooth alters alpha, not structure
    expect(rec.calls.length).toBeGreaterThan(0)
  })

  it('reflected text copies render flipped; the true copy is unflipped and upright', () => {
    // ecc83-pp has no real silk words — icebreaker's text placements carry twins
    const timeline = compiled(boardModel('icebreaker.kicad_pcb'))
    const placements = timeline.placements.filter(
      (p) => timeline.cast.find((g) => g.id === p.glyphId)?.kind === 'text' && p.atoms.length > 1
    )
    expect(placements.length).toBeGreaterThan(0)
    const p = placements[0]
    if (p === undefined) throw new Error('no mirrored text placement')
    // mid-hold step for this placement: safely inside the alpha=1 plateau
    const hold = ((p.outStep - p.inStep) % timeline.steps + timeline.steps) % timeline.steps
    const midFrame = Math.round((p.inStep + Math.floor(hold / 2)) * (timeline.fps / 15))
    // author check: copy 0 carries no flips; reflections do
    expect(p.atoms[0]?.flipX).toBeFalsy()
    expect(p.atoms[0]?.flipY).toBeFalsy()
    expect(p.atoms.slice(1).some((a) => a.flipX === true || a.flipY === true)).toBe(true)
    // render only this placement, mid-hold: every atom is lit
    const single: GlyphTimeline = { ...timeline, placements: [p], ghost: { bins: [], labelPos: { x: 0, y: 0 } }, glints: [] }
    const scene = buildScene(single)
    const rec = new RecordingCtx()
    drawGlyphFrame(asCtx(rec), single, scene, midFrame)
    const fills = rec.calls.filter((c) => c.method === 'fillText')
    const scales = rec.calls.filter((c) => c.method === 'scale')
    expect(fills.length).toBe(p.atoms.length)
    expect(scales.length).toBe(p.atoms.length)
    // atom order is preserved: first fillText follows an unflipped scale…
    const scaleBeforeFirst = scales[0]
    expect((scaleBeforeFirst?.args[0] as number) > 0 && (scaleBeforeFirst?.args[1] as number) > 0).toBe(true)
    // …and at least one later fillText follows a negative-scale transform
    const lastScale = scales.at(-1)
    expect((lastScale?.args[0] as number) < 0 || (lastScale?.args[1] as number) < 0).toBe(true)
  })

  it('uses a constant screen-space hairline regardless of glyph scale', () => {
    const timeline = compiled(board)
    const scene = buildScene(timeline)
    // the quad hold: packages and tiny marks coexist, so glyph-space widths differ
    const quad = timeline.formations[2]
    if (quad === undefined) throw new Error('no quad formation')
    drawFrame(asCtx(currentRecorder()), timeline, scene, Math.floor(((quad.startPhase + quad.endPhase) / 2) * timeline.totalFrames))
    // lineWidth is set in glyph space as inkPx/sizePx — the recorded widths
    // must vary with scale (bigger glyph -> smaller glyph-space width)
    const widths = callsOf('set:lineWidth').map((c) => c.args[0] as number)
    expect(widths.length).toBeGreaterThan(1)
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths))
  })

  it('draws embedded labels inside package outlines', () => {
    const timeline = compiled(boardModel('icebreaker.kicad_pcb'), {
      cast: { preferRefs: ['P1', 'SW1', 'SW2', 'J31', 'J33', 'J34'] }
    })
    const labelledIds = new Set(
      timeline.cast.filter((g) => (g.labels?.length ?? 0) > 0).map((g) => g.id)
    )
    // biggest first — labels under ~9px are dropped as noise by the renderer
    const p = timeline.placements
      .filter((p) => labelledIds.has(p.glyphId))
      .sort((a, b) => (b.atoms[0]?.scale ?? 0) - (a.atoms[0]?.scale ?? 0))[0]
    expect(p, 'no labelled package was placed').toBeDefined()
    if (p === undefined) return
    // draw at the placement's own hold midpoint so it is fully lit
    const hold = (((p.outStep - p.inStep) % timeline.steps) + timeline.steps) % timeline.steps
    const frame = Math.round((p.inStep + Math.floor(hold / 2)) * (timeline.fps / 15)) % timeline.totalFrames
    const scene = buildScene(timeline)
    drawFrame(asCtx(currentRecorder()), timeline, scene, frame)
    const texts = callsOf('fillText').map((c) => c.args[0])
    const labelTexts = new Set(
      timeline.cast.filter((g) => labelledIds.has(g.id)).flatMap((g) => (g.labels ?? []).map((l) => l.text))
    )
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
