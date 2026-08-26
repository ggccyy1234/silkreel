import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig } from '@silk-reel/choreo'
import { boardModel } from '../../choreo/test/helpers.js'
import { makeSyntheticBoard } from '../../choreo/test/synthetic.js'
import { buildGeometryLookup, computeViewBox, drawTimelineFrame } from './film.js'
import { asCtx, currentRecorder } from './test-recorder.js'

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

describe('render geometry lookup', () => {
  it('resolves every timeline element id on ecc83 to drawable geometry', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const missing: string[] = []
    for (const el of tl.elements) {
      if (!lookup.get(el.geomRef)) missing.push(el.geomRef)
    }
    expect(missing, `missing geometry for ${missing.slice(0, 8).join(', ')}`).toEqual([])
  })

  it('viewbox fits board bounds inside the frame with margin', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const geoms = tl.elements.map((el) => lookup.get(el.geomRef)).filter((g) => g !== undefined)
    const view = computeViewBox(geoms, tl.width, tl.height)
    expect(view.scale).toBeGreaterThan(0)
    const leftmost = view.offsetX + view.scale * Math.min(...geoms.map((g) => g.x0))
    const rightmost = view.offsetX + view.scale * Math.max(...geoms.map((g) => g.x1))
    expect(leftmost).toBeGreaterThanOrEqual(0)
    expect(rightmost).toBeLessThanOrEqual(tl.width)
  })
})

describe('drawTimelineFrame aesthetic floor', () => {
  it('paints the #050505 ground before any element stroke', () => {
    const board = makeSyntheticBoard(40)
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, 0)
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
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, 0)
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
    const board = makeSyntheticBoard(120)
    const tl = compileTimeline(board, cfg({ knobs: { flicker: 0.9 } }))
    const lookup = buildGeometryLookup(board)
    const act = tl.acts[Math.min(2, tl.acts.length - 1)]
    expect(act).toBeDefined()
    if (!act) return
    const sustain = act.phases.find((p) => p.kind === 'sustain')
    if (!sustain) return

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

    const a = alphasAt(sustain.startFrame + 1)
    const b = alphasAt(sustain.startFrame + 2)
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
    const phR = phosphor.grays.reduce((s, v) => s + v, 0) / Math.max(1, phosphor.grays.length)
    void phR
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
  it('applies placement plus interpolated dx/dy as translate offsets', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const copperAct = tl.acts.find((a) => a.id.startsWith('copper'))
    expect(copperAct).toBeDefined()
    if (!copperAct) return
    const moved = tl.elements.filter(
      (el) => el.actId === copperAct.id && (el.placement.dx !== 0 || el.placement.dy !== 0 || el.keyframes.some((k) => (k.dx ?? 0) !== 0 || (k.dy ?? 0) !== 0))
    )
    expect(moved.length).toBeGreaterThan(0)

    const lookup = buildGeometryLookup(board)
    const buildFrame = Math.floor((copperAct.startFrame + copperAct.endFrame) / 2)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, buildFrame)
    expect(summarize(rec).translateDeltas.length).toBeGreaterThan(0)
  })

  it('final frame still strokes elements (sparse core reaches pixels)', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, tl.totalFrames - 1)
    const summary = summarize(rec)
    expect(summary.count).toBeGreaterThan(4)
    expect(summary.maxAlpha).toBeLessThan(0.6)
  })

  it('elements outside their keyframe window are skipped entirely', () => {
    const board = makeSyntheticBoard(80)
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const earlyAct = tl.acts[0]
    expect(earlyAct).toBeDefined()
    if (!earlyAct) return
    const rec = currentRecorder()
    drawTimelineFrame(asCtx(rec), { timeline: tl, geometry: lookup }, 0)
    const summary = summarize(rec)
    expect(summary.count).toBeLessThan(tl.elements.length / 2)
  })

  it('viewbox maps board bounds inside the frame with margin', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const tl = compileTimeline(board, cfg())
    const lookup = buildGeometryLookup(board)
    const geoms = tl.elements.map((el) => lookup.get(el.geomRef)).filter((g) => g !== undefined)
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
})
