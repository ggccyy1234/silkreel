import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../config'
import type { FilmConfig, TraceScene } from '../types'
import { makeCam, project, sampleShot } from './camera'
import { buildTraceScene, TRACE_ACTS } from './scene'
import { boardModel } from '../../test/helpers'

const BOARDS = ['glasgow', 'icebreaker', 'StickHub', 'ecc83-pp', 'video', 'kit-dev-coldfire-xilinx_5213']

function scene(name: string, aspect: FilmConfig['aspect'] = '4:5'): TraceScene {
  const config: FilmConfig = {
    style: 'trace', aspect, knobs: {}, seed: 42, duration: 'auto', output: { width: 1080, height: 1350, fps: 30 }
  }
  return buildTraceScene(boardModel(`${name}.kicad_pcb`), resolveConfig(config), 42).scene
}

describe('the trace score', () => {
  const cache = new Map(BOARDS.map((b) => [b, scene(b)]))

  for (const name of BOARDS) {
    const s = cache.get(name) as TraceScene

    it(`${name}: every seg is routed inside the drawing act and names a real group`, () => {
      for (const layer of s.layers) {
        expect(layer.groups.length).toBe(layer.segs.length / 7)
        expect(layer.energy.length).toBe(layer.groups.length * 2)
        for (let i = 0; i < layer.groups.length; i++) {
          const g = layer.groups[i] as number
          expect(g === -1 || (g >= 0 && g < s.groups.length)).toBe(true)
          const t0 = layer.segs[i * 7 + 5] as number
          const t1 = layer.segs[i * 7 + 6] as number
          expect(t0).toBeGreaterThanOrEqual(TRACE_ACTS.draw[0] - 1e-9)
          expect(t1).toBeLessThanOrEqual(TRACE_ACTS.draw[1] + 1e-9)
          expect(t1).toBeGreaterThanOrEqual(t0)
        }
      }
    })

    it(`${name}: no light before power-on; pulses ride after their unit has lit`, () => {
      for (const layer of s.layers) {
        for (let i = 0; i < layer.energy.length; i += 2) {
          const e0 = layer.energy[i] as number
          if (e0 < 0) continue
          expect(e0).toBeGreaterThanOrEqual(TRACE_ACTS.power[0] - 1e-9)
          expect(layer.energy[i + 1] as number).toBeLessThanOrEqual(TRACE_ACTS.power[1] + 1e-9)
        }
      }
      for (const g of s.groups) {
        if (g.kind === 'ground') expect(g.t).toBe(-1)
        for (const p of g.pulses) {
          expect(p).toBeGreaterThan(g.t + g.d)
          expect(p).toBeLessThan(1)
        }
      }
    })

    it(`${name}: shots ascend, cut on the beat grid and land on a sharp three-quarter hero`, () => {
      expect(s.shots[0]?.t).toBe(0)
      expect(s.shots.at(-1)?.t).toBe(1)
      for (let i = 1; i < s.shots.length; i++) expect((s.shots[i] as { t: number }).t).toBeGreaterThan((s.shots[i - 1] as { t: number }).t)
      const cuts = s.shots.filter((k) => k.cut === true)
      expect(cuts.length).toBe(3)
      for (const c of cuts) expect(c.t * 48).toBeCloseTo(Math.round(c.t * 48), 6)
      const hero = s.shots.at(-1)
      expect(hero?.tilt).toBeGreaterThan(0.3)
      expect(hero?.tilt).toBeLessThan(0.7)
      expect(hero?.aperture).toBeLessThanOrEqual(0.05)
    })

    it(`${name}: the hero frame holds the whole board`, () => {
      const W = 1080
      const H = 1350
      const cam = makeCam(sampleShot(s.shots, 0.99), W, H)
      for (const loop of s.board) {
        for (let i = 0; i + 1 < loop.length; i += 2) {
          const q = project(cam, loop[i] as number, loop[i + 1] as number, 0)
          expect(Math.abs(q.x)).toBeLessThanOrEqual(1)
          expect(Math.abs(q.y)).toBeLessThanOrEqual(1)
        }
      }
    })

    it(`${name}: parts are set down after the mask, the hero first, and snap square at reflow`, () => {
      expect(s.parts.length).toBeGreaterThan(0)
      const hero = s.parts.filter((pt) => pt.hero === true)
      expect(hero.length).toBeLessThanOrEqual(1)
      const first = Math.min(...s.parts.map((pt) => pt.t))
      for (const pt of s.parts) {
        expect(pt.t).toBeGreaterThanOrEqual(TRACE_ACTS.place[0])
        expect(pt.t).toBeLessThanOrEqual(TRACE_ACTS.place[1])
        expect(pt.settle).toBeGreaterThanOrEqual(TRACE_ACTS.reflow[0])
        expect(pt.settle).toBeLessThanOrEqual(TRACE_ACTS.reflow[1])
        if (pt.hero === true) expect(pt.t).toBe(first)
        expect(pt.w).toBeGreaterThan(0)
        expect(pt.z).toBeGreaterThan(0)
      }
    })

    it(`${name}: the board area is closed loops`, () => {
      expect(s.board.length).toBeGreaterThan(0)
      for (const loop of s.board) expect(loop.length).toBeGreaterThanOrEqual(6)
    })
  }

  it('every act starts on the half-beat grid', () => {
    for (const [a] of Object.values(TRACE_ACTS)) expect(a * 48).toBeCloseTo(Math.round(a * 48), 6)
  })

  it('a bus lights together and lands together — length-matched lines arrive on one frame', () => {
    const s = cache.get('glasgow') as TraceScene
    const bus = s.groups.findIndex((g) => g.kind === 'bus' && g.t >= 0)
    expect(bus).toBeGreaterThanOrEqual(0)
    const g = s.groups[bus] as TraceScene['groups'][number]
    let first = Infinity
    let last = -Infinity
    for (const layer of s.layers) {
      layer.groups.forEach((gi, i) => {
        if (gi !== bus) return
        first = Math.min(first, layer.energy[i * 2] as number)
        last = Math.max(last, layer.energy[i * 2 + 1] as number)
      })
    }
    expect(first).toBeCloseTo(g.t, 6)
    expect(last).toBeCloseTo(g.t + g.d, 6)
  })

  it('reads the board build into its material', () => {
    expect((cache.get('glasgow') as TraceScene).material.mask).toBe('#d8dbd4')
    expect((cache.get('kit-dev-coldfire-xilinx_5213') as TraceScene).material.finish).toBe('#e3bb6c')
    expect((cache.get('icebreaker') as TraceScene).material.mask).toBe('#0c0d0e')
  })

  it('shoots a back-side hero from the back: StickHub reads as itself, not mirrored', () => {
    const s = cache.get('StickHub') as TraceScene
    expect(s.texts.some((t) => t.text === 'StickHub')).toBe(true)
  })
})
