import { describe, expect, it } from 'vitest'
import { compileTimeline, sampleElement, ease } from './index.js'
import type { FilmConfig } from './index.js'
import { boardModel, makeSyntheticBoard, syntheticBoardFrom, type SyntheticElement } from './helpers.js'

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

const ecc83 = () => boardModel('ecc83-pp.kicad_pcb')

describe('VAL-FILM-006 symmetry knob pairing topology', () => {
  function buildPhasePositions(tl: ReturnType<typeof compileTimeline>): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>()
    for (const el of tl.elements) {
      const act = tl.acts.find((a) => a.id === el.actId)
      const build = act?.phases.find((p) => p.kind === 'build')
      if (!build || el.keyframes.length === 0) continue
      let baseX = 0
      let baseY = 0
      for (const c of Object.values(boardModelCache.copper)) {
        const t = c.traces.find((t2) => t2.id === el.id)
        if (t) {
          const p0 = t.points[0]
          if (p0) {
            baseX = p0.x
            baseY = p0.y
          }
        }
        const pad = c.pads.find((p2) => p2.id === el.id)
        if (pad) {
          baseX = pad.pos.x
          baseY = pad.pos.y
        }
        const v = c.vias.find((v2) => v2.id === el.id)
        if (v) {
          baseX = v.pos.x
          baseY = v.pos.y
        }
        const z = c.zones.find((z2) => z2.id === el.id)
        if (z && z.outline[0]) {
          baseX = z.outline[0].x
          baseY = z.outline[0].y
        }
      }
      for (const s of Object.values(boardModelCache.silkscreen)) {
        const l = s.lines.find((l2) => l2.id === el.id)
        if (l) {
          const p0 = l.points[0]
          if (p0) {
            baseX = p0.x
            baseY = p0.y
          }
        }
        const t = s.texts.find((t2) => t2.id === el.id)
        if (t) {
          baseX = t.pos.x
          baseY = t.pos.y
        }
      }
      for (const o of boardModelCache.outline) {
        if (o.id === el.id && o.points[0]) {
          baseX = o.points[0].x
          baseY = o.points[0].y
        }
      }
      const last = el.keyframes[el.keyframes.length - 1]
      const endKf = last && Math.ceil(last.frame) >= build.startFrame ? last : undefined
      const dx = endKf?.dx ?? el.placement.dx
      const dy = endKf?.dy ?? el.placement.dy
      positions.set(el.id, { x: baseX + dx, y: baseY + dy })
    }
    return positions
  }

  function pairedIds(tl: ReturnType<typeof compileTimeline>): Set<string> {
    const cx = CX_CACHE
    const cy = CY_CACHE
    const posById = buildPhasePositions(tl)
    const byAct = new Map<string, typeof tl.elements>()
    for (const e of tl.elements) {
      if (!posById.has(e.id)) continue
      const arr = byAct.get(e.actId) ?? []
      arr.push(e)
      byAct.set(e.actId, arr)
    }
    const paired = new Set<string>()
    for (const [actId] of byAct) {
      const els = byAct.get(actId) ?? []
      const used = new Set<string>()
      for (const a of els) {
        if (used.has(a.id)) continue
        used.add(a.id)
        const pa = posById.get(a.id)
        if (!pa) continue
        const b = els.find((cand) => {
          if (used.has(cand.id) || cand.id === a.id) return false
          const pb = posById.get(cand.id)
          if (!pb) return false
          const sameRow = Math.abs(pa.y - pb.y) < TOL_X
          const mirrorX = Math.abs(pa.x + pb.x - 2 * cx) < 2 * TOL_X && Math.abs(pa.x - pb.x) > TOL_X
          const sameCol = Math.abs(pa.x - pb.x) < TOL_X
          const mirrorY = Math.abs(pa.y + pb.y - 2 * cy) < 2 * TOL_X && Math.abs(pa.y - pb.y) > TOL_X
          return (sameRow && mirrorX) || (sameCol && mirrorY)
        })
        if (b) {
          used.add(b.id)
          paired.add(a.id)
          paired.add(b.id)
        }
      }
    }
    return paired
  }

  const TOL_X = 1.5
  let boardModelCache: ReturnType<typeof boardModel>
  let CX_CACHE = 0
  let CY_CACHE = 0

  it('mirror modes produce mirrored pair sets, none produces near-zero pairs', () => {
    const board = ecc83()
    boardModelCache = board
    CX_CACHE = (board.bbox.min.x + board.bbox.max.x) / 2
    CY_CACHE = (board.bbox.min.y + board.bbox.max.y) / 2

    const pairCountUnder = (symmetry: 'mirror-x' | 'mirror-y' | 'quad' | 'none'): number => {
      const tl = compileTimeline(board, cfg({ knobs: { symmetry } }))
      return pairedIds(tl).size
    }

    const mirrorXCount = pairCountUnder('mirror-x')
    const mirrorYCount = pairCountUnder('mirror-y')
    const quadCount = pairCountUnder('quad')
    const noneCount = pairCountUnder('none')

    expect(mirrorXCount).toBeGreaterThan(10)
    expect(mirrorYCount).toBeGreaterThan(10)
    expect(quadCount).toBeGreaterThan(mirrorXCount)
    expect(noneCount).toBeLessThan(mirrorXCount / 3)

    const mirrorXTl = compileTimeline(board, cfg({ knobs: { symmetry: 'mirror-x' } }))
    const mirrorYTl = compileTimeline(board, cfg({ knobs: { symmetry: 'mirror-y' } }))
    const xIds = [...pairedIds(mirrorXTl)]
    const ySet = pairedIds(mirrorYTl)
    const overlap = xIds.filter((id) => ySet.has(id)).length
    expect(overlap / Math.max(1, xIds.length)).toBeLessThan(0.9)
  })
})

describe('VAL-FILM-007 rhythmDensity inter-appearance gaps', () => {
  function gapStats(density: number) {
    const tl = compileTimeline(makeSyntheticBoard(300), cfg({ knobs: { rhythmDensity: density } }))
    const populatePhases = tl.acts.flatMap((a) => a.phases.filter((p) => p.kind === 'populate'))
    const inPopulate = tl.elements.filter((e) =>
      e.keyframes.some(
        (k) => k.opacity > 0 && populatePhases.some((p) => Math.ceil(k.frame) >= p.startFrame && Math.ceil(k.frame) <= p.endFrame)
      )
    )
    const appearFrames = inPopulate
      .map((e) => {
        const first = e.keyframes.find((k) => k.opacity > 0)
        return first ? Math.ceil(first.frame) : Number.MAX_SAFE_INTEGER
      })
      .sort((a, b) => a - b)
    const gaps: number[] = []
    for (let i = 1; i < appearFrames.length; i++) {
      const prev = appearFrames[i - 1]
      const cur = appearFrames[i]
      if (prev !== undefined && cur !== undefined && cur !== prev) gaps.push(cur - prev)
    }
    const zeroGaps = appearFrames.length - 1 - gaps.length
    gaps.sort((a, b) => a - b)
    const median = gaps[Math.floor(gaps.length / 2)] ?? 1
    const p90 = gaps[Math.floor(gaps.length * 0.9)] ?? 1
    const span = (appearFrames[appearFrames.length - 1] ?? 0) - (appearFrames[0] ?? 0)
    return { median, p90, span, zeroGaps }
  }

  it('higher density strictly shrinks median gap and populate span', () => {
    const low = gapStats(0.1)
    const mid = gapStats(0.5)
    const high = gapStats(0.9)
    expect(high.median).toBeLessThanOrEqual(mid.median)
    expect(mid.median).toBeLessThanOrEqual(low.median)
    expect(high.zeroGaps).toBeGreaterThan(low.zeroGaps)
    expect(high.span).toBeLessThanOrEqual(low.span + 2)
    expect(low.median).toBeGreaterThanOrEqual(mid.median)
  })
})

describe('VAL-FILM-008 beatCount intra-act placement', () => {
  it('beatCount 0 → no beats; N → N beats inside populate→build slots with configured intensity', () => {
    for (const [count, intensity] of [[0, 0.3], [1, 0.3], [3, 0.45]] as const) {
      const tl = compileTimeline(makeSyntheticBoard(300), cfg({ knobs: { beatCount: count, beatIntensity: intensity } }))
      expect(tl.beats.length).toBe(count)
      for (const beat of tl.beats) {
        expect(beat.intensity).toBe(intensity)
        const carrying = tl.acts.find((a) =>
          a.phases.some((p) => p.kind === 'beat' && beat.frame >= p.startFrame && beat.frame <= p.endFrame)
        )
        expect(carrying, `beat at ${beat.frame} must sit inside a beat phase`).toBeDefined()
        if (!carrying) continue
        const kinds = carrying.phases.map((p) => p.kind)
        const beatIdx = kinds.indexOf('beat')
        expect(kinds[beatIdx - 1]).toBe('populate')
        expect(kinds[beatIdx + 1]).toBe('build')
      }
      const phaseBeats = tl.acts.flatMap((a) => a.phases.filter((p) => p.kind === 'beat')).length
      expect(phaseBeats).toBe(count)
    }
  })

  it('elements sit near-zero opacity at the beat frame', () => {
    const tl = compileTimeline(makeSyntheticBoard(300), cfg({ knobs: { beatCount: 1, beatIntensity: 0.15 } }))
    const beat = tl.beats[0]
    expect(beat).toBeDefined()
    if (!beat) return
    let visibleBefore = 0
    let nearZeroAtBeat = 0
    for (const el of tl.elements) {
      const before = opacityAt(el, beat.frame - 1)
      if ((before ?? 0) > 0.05) visibleBefore++
      const at = opacityAt(el, beat.frame)
      if ((at ?? 0) < 0.05) nearZeroAtBeat++
    }
    expect(visibleBefore).toBeGreaterThan(50)
    expect(nearZeroAtBeat / visibleBefore).toBeGreaterThan(0.9)
  })

  function opacityAt(el: { keyframes: Array<{ frame: number; opacity: number }> }, frame: number): number | undefined {
    if (el.keyframes.length === 0) return undefined
    if (frame <= (el.keyframes[0]?.frame ?? 0)) return el.keyframes[0]?.opacity
    for (let i = 1; i < el.keyframes.length; i++) {
      const prev = el.keyframes[i - 1]
      const cur = el.keyframes[i]
      if (prev && cur && frame <= cur.frame) return cur.opacity
    }
    return el.keyframes[el.keyframes.length - 1]?.opacity
  }
})

describe('VAL-FILM-009 dissolveStyle exit ordering', () => {
  interface ExitSample { id: string; exit: number; radial: number; xAxis: number }

  function exits(style: 'center-out' | 'fade' | 'wipe' | 'scatter'): ExitSample[] {
    const board = makeSyntheticBoard(300)
    const tl = compileTimeline(
      board,
      cfg({
        knobs: { dissolveStyle: style },
        actOrder: ['outline', 'drill', 'silk:F.SilkS', 'copper:B.Cu', 'copper:F.Cu']
      })
    )
    const finalAct = tl.acts[tl.acts.length - 1]
    const dissolvePhase = finalAct?.phases.find((p) => p.kind === 'dissolve')
    if (!finalAct || !dissolvePhase) throw new Error('no dissolve phase')
    const posById = new Map<string, { x: number; y: number }>()
    for (const c of Object.values(board.copper)) {
      for (const t of c.traces) {
        if (!posById.has(t.id)) posById.set(t.id, t.points[0] ?? { x: 0, y: 0 })
      }
    }
    for (const s of Object.values(board.silkscreen)) {
      for (const t of s.texts) posById.set(t.id, t.pos)
    }
    const cx = (board.bbox.min.x + board.bbox.max.x) / 2
    const cy = (board.bbox.min.y + board.bbox.max.y) / 2
    const samples: ExitSample[] = []
    for (const el of tl.elements) {
      if (el.actId !== finalAct.id) continue
      let lastPositive: number | undefined
      for (let i = el.keyframes.length - 1; i >= 0; i--) {
        const k = el.keyframes[i]
        if (k && k.opacity > 0.02) {
          lastPositive = Math.ceil(k.frame)
          break
        }
      }
      const pos = posById.get(el.id)
      if (lastPositive === undefined || !pos) continue
      samples.push({
        id: el.id,
        exit: lastPositive,
        radial: Math.hypot(pos.x - cx, pos.y - cy),
        xAxis: pos.x
      })
    }
    expect(samples.length).toBeGreaterThan(100)
    return samples
  }

  function corr(samples: ExitSample[], key: 'radial' | 'xAxis'): number {
    const n = samples.length
    const mx = samples.reduce((s, x) => s + x[key], 0) / n
    const my = samples.reduce((s, x) => s + x.exit, 0) / n
    let num = 0
    let dx = 0
    let dy = 0
    for (const s of samples) {
      const a = s[key] - mx
      const b = s.exit - my
      num += a * b
      dx += a * a
      dy += b * b
    }
    return num / Math.sqrt(dx * dy || 1)
  }

  it('four styles produce mutually distinguishable exit signatures', () => {
    const fade = exits('fade')
    const centerOut = exits('center-out')
    const wipe = exits('wipe')
    const scatter = exits('scatter')
    const spanOf = (samples: ExitSample[]) => {
      const frames = samples.map((s) => s.exit).sort((a, b) => a - b)
      return (frames[frames.length - 1] ?? 0) - (frames[0] ?? 0)
    }
    const dissolveSpanFrames = fade.length > 0 ? Math.max(...fade.map((s) => s.exit)) - Math.min(...fade.map((s) => s.exit)) : 0
    expect(spanOf(fade)).toBeLessThanOrEqual(dissolveSpanFrames + 2)
    const rCenter = corr(centerOut, 'radial')
    expect(rCenter, 'center-out exits must order by radial distance').toBeLessThan(-0.3)
    const rWipe = corr(wipe, 'xAxis')
    expect(Math.abs(rWipe), 'wipe exits must order along x').toBeGreaterThan(0.4)
    const rScatterRadial = corr(scatter, 'radial')
    const rScatterAxis = corr(scatter, 'xAxis')
    expect(Math.max(Math.abs(rScatterRadial), Math.abs(rScatterAxis)), 'scatter must not correlate with position').toBeLessThan(0.45)
    expect(rCenter).not.toBeCloseTo(rWipe, 1)
  })
})

describe('VAL-FILM-010 easing knob reaches render parameters and curves', () => {
  it('easing value is carried into renderParams for the composition to consume', () => {
    for (const easing of ['linear', 'expo-out', 'back-out', 'sine'] as const) {
      const tl = compileTimeline(makeSyntheticBoard(60), cfg({ knobs: { easing } }))
      expect(tl.renderParams.easing).toBe(easing)
    }
  })

  it('compiler interpolation diverges between linear and expo-out at midpoints', () => {
    const linTl = compileTimeline(makeSyntheticBoard(120), cfg({ knobs: { easing: 'linear' } }))
    const expTl = compileTimeline(makeSyntheticBoard(120), cfg({ knobs: { easing: 'expo-out' } }))
    const linEl = pickRising(linTl)
    const expEl = pickRising(expTl)
    expect(linEl && expEl).toBeTruthy()
    if (!linEl || !expEl) return
    const a = linEl.keyframes[0]
    const b = linEl.keyframes[1]
    expect(a && b).toBeTruthy()
    if (!a || !b) return
    const mid = (a.frame + b.frame) / 2
    const linV = sampleElement(linEl, 'linear').get(Math.floor(mid)) ?? interpAt(linEl, mid, 'linear')
    const expV = interpAt(expEl, mid, 'expo-out')
    expect(Math.abs(expV - b.opacity)).toBeLessThan(Math.abs(linV - b.opacity))
  })

  it('back-out overshoots past its target when interpolated', () => {
    const tl = compileTimeline(makeSyntheticBoard(120), cfg({ knobs: { easing: 'back-out' } }))
    const el = pickRising(tl)
    expect(el).toBeDefined()
    if (!el) return
    const a = el.keyframes[0]
    const b = el.keyframes[1]
    if (!a || !b) return
    let maxV = -Infinity
    for (let f = a.frame; f <= b.frame + 1; f++) {
      maxV = Math.max(maxV, interpAt(el, f, 'back-out'))
    }
    expect(maxV).toBeGreaterThan(b.opacity + 0.01)
  })

  function pickRising(tl: ReturnType<typeof compileTimeline>) {
    return tl.elements.find((e) => {
      const a = e.keyframes[0]
      const b = e.keyframes[1]
      return a !== undefined && b !== undefined && b.opacity > a.opacity && b.frame - a.frame >= 3
    })
  }

  function interpAt(el: { keyframes: Array<{ frame: number; opacity: number }> }, frame: number, easing: 'linear' | 'expo-out' | 'back-out'): number {
    const kfs = [...el.keyframes].sort((x, y) => x.frame - y.frame)
    if (frame <= (kfs[0]?.frame ?? 0)) return kfs[0]?.opacity ?? 0
    for (let i = 1; i < kfs.length; i++) {
      const prev = kfs[i - 1]
      const cur = kfs[i]
      if (prev && cur && frame <= cur.frame) {
        const t = (frame - prev.frame) / Math.max(1, cur.frame - prev.frame)
        const eased = ease(t, easing)
        return prev.opacity + (cur.opacity - prev.opacity) * eased
      }
    }
    return kfs[kfs.length - 1]?.opacity ?? 0
  }
})

describe('VAL-FILM-011 render parameter plumbing', () => {
  it('neutral config resolves to grayscale palette and neutral params', () => {
    const tl = compileTimeline(ecc83(), cfg())
    expect(tl.palette.name).toBe('mono')
    expect(tl.palette.stroke).toEqual({ r: null, g: null, b: null })
    expect(tl.palette.glowHue).toEqual({ r: null, g: null, b: null })
    expect(tl.renderParams.glow).toBe(0)
    expect(tl.renderParams.flicker).toBe(0)
    expect(tl.renderParams.grain).toBe(0)
    expect(tl.renderParams.exposure).toBe(1)
  })

  it('every knob leaves a visible trace in the render-parameter surface', () => {
    const tl = compileTimeline(
      ecc83(),
      cfg({
        knobs: {
          glow: 0.8,
          flicker: 0.5,
          grain: 0.4,
          exposure: 1.5,
          palette: 'amber',
          easing: 'back-out'
        }
      })
    )
    expect(tl.palette.name).toBe('amber')
    expect(tl.palette.stroke).toEqual({ r: 255, g: 176, b: 59 })
    expect(tl.renderParams.glow).toBe(0.8)
    expect(tl.renderParams.flicker).toBe(0.5)
    expect(tl.renderParams.grain).toBe(0.4)
    expect(tl.renderParams.exposure).toBe(1.5)
    expect(tl.renderParams.easing).toBe('back-out')

    const zeroed = compileTimeline(
      ecc83(),
      cfg({ knobs: { glow: 0, flicker: 0, grain: 0, exposure: 1, palette: 'mono' } })
    )
    expect(zeroed.renderParams.glow).toBe(0)
    expect(zeroed.palette.stroke).toEqual({ r: null, g: null, b: null })
  })
})

describe('VAL-FILM-020 seedPairs and rotational180', () => {
  function seedVisibleCount(pairs: number): number {
    const tl = compileTimeline(makeSyntheticBoard(200), cfg({ knobs: { seedPairs: pairs, symmetry: 'rotational180' } }))
    const copperAct = tl.acts.find((a) => a.id === 'copper:F.Cu')
    const seedPhase = copperAct?.phases.find((p) => p.kind === 'seed')
    if (!copperAct || !seedPhase) return 0
    return tl.elements.filter(
      (e) => e.actId === copperAct.id && e.keyframes.some((k) => k.opacity > 0 && k.frame <= Math.ceil(seedPhase.endFrame))
    ).length
  }

  it('seed-phase element count tracks the seedPairs knob', () => {
    const at1 = seedVisibleCount(1)
    const at4 = seedVisibleCount(4)
    expect(at1, `seedPairs=1 seeded ${at1} elements in the copper act`).toBeGreaterThanOrEqual(2)
    expect(at4).toBeGreaterThan(at1)
  })

  it('rotational180 pairing is point-symmetric about center and distinct from quad', () => {
    const board = syntheticAsymmetricBoard()
    const rot = compileTimeline(board, cfg({ knobs: { symmetry: 'rotational180' } }))
    const quad = compileTimeline(board, cfg({ knobs: { symmetry: 'quad' } }))
    const cx = (board.bbox.min.x + board.bbox.max.x) / 2
    const cy = (board.bbox.min.y + board.bbox.max.y) / 2
    const rotPairs = pointSymmetricPairs(rot, board, cx, cy)
    expect(rotPairs.length).toBeGreaterThan(5)
    for (const [aId, bId] of rotPairs) {
      const a = posIn(board, aId)
      const b = posIn(board, bId)
      expect(a && b).toBeTruthy()
      if (!a || !b) continue
      expect(Math.abs(a.x + b.x - 2 * cx)).toBeLessThan(PAIR_TOL_TEST)
      expect(Math.abs(a.y + b.y - 2 * cy)).toBeLessThan(PAIR_TOL_TEST)
    }
    const quadPairSet = new Set(pointSymmetricPairs(quad, board, cx, cy).map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)))
    const rotPairList = rotPairs.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`))
    const shared = rotPairList.filter((k) => quadPairSet.has(k)).length
    expect(shared / Math.max(1, rotPairList.length), 'rot180 pair set must differ from quad').toBeLessThan(0.85)
  })

  const PAIR_TOL_TEST = 3

  function syntheticAsymmetricBoard() {
    const elements: SyntheticElement[] = []
    for (let i = 0; i < 160; i++) {
      elements.push({ id: `t:${i + 1}`, kind: 'trace', pos: { x: (i % 16) * 2.54 + (i % 5), y: Math.floor(i / 16) * 2.54 }, size: 0.3 })
    }
    return syntheticBoardFrom(elements)
  }

  function pointSymmetricPairs(
    tl: ReturnType<typeof compileTimeline>,
    board: ReturnType<typeof syntheticBoardFrom>,
    cx: number,
    cy: number
  ): Array<[string, string]> {
    const buildEls = tl.elements.filter((e) => {
      const act = tl.acts.find((a) => a.id === e.actId)
      const build = act?.phases.find((p) => p.kind === 'build')
      return build !== undefined && e.keyframes.some((k) => k.opacity > 0 && Math.ceil(k.frame) >= build.startFrame)
    })
    const tol = 3
    const pairs: Array<[string, string]> = []
    const used = new Set<string>()
    for (const a of buildEls) {
      if (used.has(a.id)) continue
      const pa = posIn(board, a.id)
      if (!pa) continue
      const match = buildEls.find((b) => {
        if (b.id === a.id || used.has(b.id)) return false
        const pb = posIn(board, b.id)
        return pb !== undefined && Math.abs(pa.x + pb.x - 2 * cx) < tol && Math.abs(pa.y + pb.y - 2 * cy) < tol
      })
      if (match) {
        used.add(a.id)
        used.add(match.id)
        pairs.push([a.id, match.id])
      }
    }
    return pairs
  }

  function posIn(board: ReturnType<typeof syntheticBoardFrom>, id: string): { x: number; y: number } | undefined {
    for (const c of Object.values(board.copper)) {
      for (const t of c.traces) if (t.id === id) return t.points[0]
      for (const p of c.pads) if (p.id === id) return p.pos
      for (const v of c.vias) if (v.id === id) return v.pos
    }
    return undefined
  }
})
