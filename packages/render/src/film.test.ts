import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { CastUnit, FilmConfig, Timeline } from '@silk-reel/choreo'
import { boardModel } from '../../choreo/test/helpers.js'
import { makeSyntheticBoard } from '../../choreo/test/synthetic.js'
import type { Geom, GeometryLookup } from './film.js'
import { buildGeometryLookup, computeViewBox, drawTimelineFrame } from './film.js'
import { asCtx, currentRecorder, RecordingCtx } from './test-recorder.js'

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

interface StrokeSummary {
  count: number
  minAlpha: number
  maxAlpha: number
  maxShadowBlur: number
  grayLevels: number[]
  redGreenSpreads: number[]
  translateDeltas: Array<{ x: number; y: number }>
}

function summarize(recorder: ReturnType<typeof currentRecorder>): StrokeSummary {
  const summary: StrokeSummary = {
    count: 0,
    minAlpha: Number.POSITIVE_INFINITY,
    maxAlpha: 0,
    maxShadowBlur: 0,
    grayLevels: [],
    redGreenSpreads: [],
    translateDeltas: []
  }
  let alpha = 1
  let stroke = ''
  for (const call of recorder.calls) {
    if (call.method === 'set:globalAlpha') {
      alpha = call.args[0] as number
      continue
    }
    if (call.method === 'set:strokeStyle') {
      stroke = call.args[0] as string
      continue
    }
    if (call.method === 'set:shadowBlur') {
      summary.maxShadowBlur = Math.max(summary.maxShadowBlur, call.args[0] as number)
      continue
    }
    if (call.method === 'translate') {
      const [x, y] = call.args as [number, number]
      if (x !== 0 || y !== 0) summary.translateDeltas.push({ x, y })
      continue
    }
    if ((call.method === 'stroke' || call.method === 'fill') && stroke.length > 0) {
      summary.count += 1
      summary.minAlpha = Math.min(summary.minAlpha, alpha)
      summary.maxAlpha = Math.max(summary.maxAlpha, alpha)
      const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(stroke)
      if (m) {
        const r = Number(m[1])
        const g = Number(m[2])
        summary.grayLevels.push(r)
        summary.redGreenSpreads.push(Math.abs(r - g))
      }
    }
  }
  return summary
}

interface StrokeRecord {
  alpha: number
  gray: number
  lineWidth: number
}

function strokeRecords(recorder: ReturnType<typeof currentRecorder>): StrokeRecord[] {
  const records: StrokeRecord[] = []
  let alpha = 1
  let gray = Number.NaN
  let lineWidth = Number.NaN
  for (const call of recorder.calls) {
    if (call.method === 'set:globalAlpha') {
      alpha = call.args[0] as number
      continue
    }
    if (call.method === 'set:lineWidth') {
      lineWidth = call.args[0] as number
      continue
    }
    if (call.method === 'set:strokeStyle') {
      const value = call.args[0] as string
      const match = /rgba\((\d+),/.exec(value)
      gray = match ? Number(match[1]) : Number.NaN
      continue
    }
    if (call.method === 'stroke') records.push({ alpha, gray, lineWidth })
  }
  return records
}

function roleTimeline(base: Timeline): { timeline: Timeline; geometry: GeometryLookup } {
  const roleEntries: Array<{ id: string; role: CastUnit['role'] }> = [
    { id: 'hero', role: 'hero-body' },
    { id: 'detail', role: 'detail' },
    { id: 'anchor', role: 'anchor-pad' },
    { id: 'text', role: 'text-accent' },
    { id: 'trace', role: 'trace-accent' }
  ]
  const cast: CastUnit[] = roleEntries.map(({ id, role }) => ({
    id,
    role,
    memberRefs: [id],
    bounds: { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } },
    sourceAct: 'outline'
  }))
  const geometryById = new Map<string, Geom>(roleEntries.map(({ id }) => [id, {
    kind: 'trace',
    x0: 0,
    y0: 0,
    x1: 1,
    y1: 1,
    draw(ctx, strokeScale = 1) {
      ctx.lineWidth = strokeScale
      ctx.stroke()
    }
  }]))
  const tracks = cast.map((unit) => ({
    castId: unit.id,
    copies: { mode: 'none' as const, transforms: [{ x: 1 as const, y: 1 as const }] },
    keyframes: [{ frame: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, glow: 1 }]
  }))
  return {
    timeline: {
      ...base,
      totalFrames: 1,
      cast,
      shots: [{ id: 'horizontal-study', startFrame: 0, endFrame: 0, tracks }]
    },
    geometry: { get: (id: string) => geometryById.get(id) }
  }
}

describe('render geometry lookup', () => {
  it('resolves every directed cast member on ecc83 to drawable geometry', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const missing: string[] = []
    for (const unit of tl.cast) {
      for (const memberRef of unit.memberRefs) {
        if (!lookup.get(memberRef)) missing.push(memberRef)
      }
    }
    expect(missing, `missing geometry for ${missing.slice(0, 8).join(', ')}`).toEqual([])
  })

  it('viewbox fits board bounds inside the frame with margin', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const geoms = tl.cast.flatMap((unit) => unit.memberRefs).map((memberRef) => lookup.get(memberRef)).filter((g) => g !== undefined)
    const view = computeViewBox(geoms, tl.width, tl.height)
    expect(view.scale).toBeGreaterThan(0)
    const leftmost = view.offsetX + view.scale * Math.min(...geoms.map((g) => g.x0))
    const rightmost = view.offsetX + view.scale * Math.max(...geoms.map((g) => g.x1))
    expect(leftmost).toBeGreaterThanOrEqual(0)
    expect(rightmost).toBeLessThanOrEqual(tl.width)
  })

  it('uses the directed frame instead of shrinking the cast to a thumbnail', () => {
    const geom: Geom = {
      kind: 'outline',
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 100,
      draw() {}
    }
    const view = computeViewBox([geom], 1000, 1000)
    const projectedWidth = (geom.x1 - geom.x0) * view.scale
    const projectedHeight = (geom.y1 - geom.y0) * view.scale
    expect(projectedWidth / 1000).toBeGreaterThan(0.85)
    expect(projectedHeight / 1000).toBeGreaterThan(0.85)
  })
})

describe('drawTimelineFrame aesthetic floor', () => {
  it('paints the #050505 ground before any element stroke', () => {
    const board = makeSyntheticBoard(40)
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    const shot = tl.shots.find((candidate) => candidate.id === 'vertical-seed')
    expect(shot).toBeDefined()
    if (!shot) return
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, shot.startFrame + 2)
    const firstFill = rec.calls.find((c) => c.method === 'fillRect')
    expect(firstFill).toBeDefined()
    expect(rec.props.fillStyle).toBe('#050505')
  })

  it('mono palette strokes stay zero-chroma mid-film', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, Math.floor(tl.totalFrames * 0.71))
    const summary = summarize(rec)
    expect(summary.count).toBeGreaterThan(20)
    for (const spread of summary.redGreenSpreads) expect(spread).toBeLessThanOrEqual(2)
  })

  it('exposure raises stroke gray levels measurably', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const frame = Math.floor(135)
    const levelsFor = (exposure: number): number[] => {
      const tl = compileTimeline(board, cfg({ knobs: { exposure } }))
      const lookup = buildGeometryLookup(board)
      const rec = currentRecorder()
      drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, frame)
      return summarize(rec).grayLevels.filter((v) => v > 10)
    }
    const lowMean = levelsFor(0.7).reduce((s, v) => s + v, 0) / Math.max(1, levelsFor(0.7).length)
    const highMean = levelsFor(1.5).reduce((s, v) => s + v, 0) / Math.max(1, levelsFor(1.5).length)
    expect(highMean).toBeGreaterThan(lowMean + 15)
  })

  it('glow engages shadow blur on strokes', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const blurs: number[] = []
    for (const glow of [0, 0.8]) {
      const tl = compileTimeline(board, cfg({ knobs: { glow } }))
      const lookup = buildGeometryLookup(board)
      const rec = currentRecorder()
      drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, 135)
      blurs.push(summarize(rec).maxShadowBlur)
    }
    expect(blurs[0]).toBe(0)
    expect(blurs[1]).toBeGreaterThan(0)
  })

  it('grain overlays noise via putImageData at the end of the pass', () => {
    const board = makeSyntheticBoard(60)
    const tl = compileTimeline(board, cfg({ knobs: { grain: 0.9 } }))
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    const shot = tl.shots.find((candidate) => candidate.id === 'vertical-seed')
    expect(shot).toBeDefined()
    if (!shot) return
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, shot.startFrame + 2)
    const puts = rec.calls.filter((c) => c.method === 'putImageData')
    expect(puts.length).toBe(1)
    const lastTransform = [...rec.calls].reverse().find((c) => c.method === 'setTransform')
    const putIdx = rec.calls.findIndex((c) => c.method === 'putImageData')
    const transformIdx = lastTransform ? rec.calls.lastIndexOf(lastTransform) : -1
    expect(putIdx).toBeGreaterThan(transformIdx)
  })

  it('no grain means no putImageData call', () => {
    const board = makeSyntheticBoard(60)
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, 3)
    expect(rec.calls.some((c) => c.method === 'putImageData')).toBe(false)
  })

  it('flicker modulates per-element alpha within a sustain window', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg({ knobs: { flicker: 0.9 } }))
    const lookup = buildGeometryLookup(board)
    const shot = tl.shots.find((candidate) => candidate.id === 'bilateral-tower')
    expect(shot).toBeDefined()
    if (!shot) return

    const alphasAt = (frame: number): number[] => {
      const rec = currentRecorder()
      drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, frame)
      const vals: number[] = []
      let pendingAlpha = 1
      for (const call of rec.calls) {
        if (call.method === 'set:globalAlpha') {
          pendingAlpha = call.args[0] as number
          continue
        }
        if (call.method === 'stroke' || call.method === 'fill') vals.push(pendingAlpha)
      }
      return vals
    }

    const a = alphasAt(Math.min(shot.endFrame - 2, shot.startFrame + 8))
    const b = alphasAt(Math.min(shot.endFrame - 1, shot.startFrame + 9))
    expect(a.length).toBeGreaterThan(5)
    expect(a.some((v) => v < 0.999)).toBe(true)
    expect(a.join(',')).not.toBe(b.join(','))
  })

  it('palette presets tint strokes; mono stays gray', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const frame = 135
    const levelsAndSpreads = (palette: 'mono' | 'phosphor' | 'amber'): { grays: number[]; spreadsRG: number[]; spreadsGB: number[] } => {
      const tl = compileTimeline(board, cfg({ knobs: { palette } }))
      const lookup = buildGeometryLookup(board)
      const rec = currentRecorder()
      drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, frame)
      const grays: number[] = []
      const sRG: number[] = []
      const sGB: number[] = []
      let stroke = ''
      for (const call of rec.calls) {
        if (call.method === 'set:strokeStyle') {
          stroke = call.args[0] as string
          continue
        }
        if ((call.method === 'stroke' || call.method === 'fill') && stroke.startsWith('rgba')) {
          const m = /rgba\((\d+),(\d+),(\d+),/.exec(stroke)
          if (m) {
            const r = Number(m[1])
            const g = Number(m[2])
            const b = Number(m[3])
            grays.push(r)
            sRG.push(Math.abs(r - g))
            sGB.push(Math.abs(g - b))
          }
        }
      }
      return { grays, spreadsRG: sRG, spreadsGB: sGB }
    }

    const mono = levelsAndSpreads('mono')
    expect(mono.spreadsRG.every((s) => s <= 2)).toBe(true)

    const phosphor = levelsAndSpreads('phosphor')
    expect(phosphor.spreadsRG.some((s) => s > 10)).toBe(true)

    const amber = levelsAndSpreads('amber')
    expect(amber.spreadsRG.some((s) => s > 20)).toBe(true)
    expect(amber.spreadsGB.some((s) => s > 40)).toBe(true)
    expect(amber.grays.length).toBeGreaterThan(0)

    const phosphorCheck = (() => {
      const tl = compileTimeline(board, cfg({ knobs: { palette: 'phosphor' } }))
      const lookup = buildGeometryLookup(board)
      const rec = currentRecorder()
      drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, frame)
      const grays: number[] = []
      const spreadsGR: number[] = []
      let stroke = ''
      for (const call of rec.calls) {
        if (call.method === 'set:strokeStyle') {
          stroke = call.args[0] as string
          continue
        }
        if ((call.method === 'stroke' || call.method === 'fill') && stroke.startsWith('rgba')) {
          const m = /rgba\((\d+),(\d+),(\d+),/.exec(stroke)
          if (m) {
            grays.push(Number(m[1]))
            spreadsGR.push(Math.abs(Number(m[2]) - Number(m[1])))
          }
        }
      }
      return { grays, spreadsGR }
    })()
    expect(phosphorCheck.spreadsGR.some((s) => s > 60)).toBe(true)
  })
})

describe('render placement and interpolation contract', () => {
  it('applies sampled directed positions as translate offsets', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const shot = tl.shots.find((candidate) => candidate.id === 'bilateral-tower')
    expect(shot?.tracks.length).toBeGreaterThan(0)
    if (!shot) return

    const lookup = buildGeometryLookup(board)
    const buildFrame = Math.floor((shot.startFrame + shot.endFrame) / 2)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, buildFrame)
    expect(summarize(rec).translateDeltas.length).toBeGreaterThan(0)
  })

  it('pad coda remains lit through frame 165 before the black cut', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, tl.totalFrames - 2)
    const summary = summarize(rec)
    expect(summary.count).toBeGreaterThanOrEqual(4)
    expect(summary.maxAlpha).toBeGreaterThan(0.8)
    const final = currentRecorder()
    final.reset()
    drawTimelineFrame(asCtx(final), { timeline: tl, geometry: lookup }, tl.totalFrames - 1)
    expect(summarize(final).count).toBe(0)
  })

  it('black breath skips all directed tracks', () => {
    const board = makeSyntheticBoard(80)
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, 0)
    expect(summarize(rec).count).toBe(0)
  })

  it('viewbox maps board bounds inside the frame with margin', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const geoms = tl.cast.flatMap((unit) => unit.memberRefs).map((memberRef) => lookup.get(memberRef)).filter((g) => g !== undefined)
    const view = computeViewBox(geoms, tl.width, tl.height)
    const leftmost = view.offsetX + view.scale * Math.min(...geoms.map((g) => g.x0))
    const rightmost = view.offsetX + view.scale * Math.max(...geoms.map((g) => g.x1))
    const topmost = view.offsetY + view.scale * Math.min(...geoms.map((g) => g.y0))
    const bottom = view.offsetY + view.scale * Math.max(...geoms.map((g) => g.y1))
    expect(leftmost).toBeGreaterThanOrEqual(-0.001)
    expect(rightmost).toBeLessThanOrEqual(tl.width + 0.001)
    expect(topmost).toBeGreaterThanOrEqual(-0.001)
    expect(bottom).toBeLessThanOrEqual(tl.height + 0.001)
    expect(view.scale).toBeGreaterThan(0)
  })

  it('differentiates directed cast roles with stroke and intensity hierarchy', () => {
    const base: Timeline = {
      fps: 15,
      totalFrames: 1,
      durationSeconds: 1 / 15,
      width: 1080,
      height: 1350,
      output: { width: 1080, height: 1350, fps: 15 },
      palette: {
        name: 'mono',
        stroke: { r: null, g: null, b: null },
        glowHue: { r: null, g: null, b: null }
      },
      cast: [],
      shots: [],
      directedBeats: [],
      renderParams: { glow: 1, flicker: 0, grain: 0, exposure: 1, easing: 'linear', symmetry: 'none' },
      warnings: [],
      seedUsed: 42
    }
    const { timeline, geometry } = roleTimeline(base)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline, geometry, view: { scale: 1, offsetX: 0, offsetY: 0 } }, 0)
    const records = strokeRecords(rec)
    expect(records).toHaveLength(5)
    expect(records.every((record) => Number.isFinite(record.lineWidth) && Number.isFinite(record.gray))).toBe(true)
    const [hero, detail, anchor, text, trace] = records
    expect(hero?.lineWidth).toBeGreaterThan(detail?.lineWidth ?? 0)
    expect(detail?.lineWidth).toBeGreaterThan(text?.lineWidth ?? 0)
    expect(text?.lineWidth).toBeGreaterThan(trace?.lineWidth ?? 0)
    expect(hero?.gray).toBeGreaterThan(detail?.gray ?? 0)
    expect(anchor?.gray).toBeGreaterThan(text?.gray ?? 0)
    expect(text?.gray).toBeGreaterThan(trace?.gray ?? 0)
    expect(hero?.alpha).toBeGreaterThan(trace?.alpha ?? 0)
  })

  it('renders directed beats as bounded exposure accents', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const timeline = compileTimeline(board, cfg({ knobs: { beatCount: 1, beatIntensity: 1, exposure: 0.7 } }))
    const geometry = buildGeometryLookup(board)
    const beat = timeline.directedBeats[0]
    expect(beat).toBeDefined()
    if (!beat) return

    const atBeat = new RecordingCtx()
    drawTimelineFrame(asCtx(atBeat), { timeline, geometry }, beat.frame + 1)
    const withoutBeat = new RecordingCtx()
    drawTimelineFrame(asCtx(withoutBeat), { timeline: { ...timeline, directedBeats: [] }, geometry }, beat.frame + 1)

    expect(Math.max(...summarize(atBeat).grayLevels)).toBeGreaterThan(Math.max(...summarize(withoutBeat).grayLevels))
  })
})
