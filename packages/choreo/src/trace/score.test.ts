import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../config'
import type { FilmConfig, TraceScene } from '../types'
import { compileTrace, makeCam, project, sampleShot, TRACE_ACTS } from './index'
import { boardModel } from '../../test/helpers'

const BOARDS = ['glasgow', 'icebreaker', 'StickHub', 'ecc83-pp', 'video', 'kit-dev-coldfire-xilinx_5213']

function scene(name: string, aspect: FilmConfig['aspect'] = '4:5'): TraceScene {
  const config: FilmConfig = {
    style: 'trace', aspect, knobs: {}, seed: 42, duration: 'auto', output: { width: 1080, height: 1350, fps: 30 }
  }
  return compileTrace(boardModel(`${name}.kicad_pcb`), resolveConfig(config), 42).scene
}

describe('the trace score', () => {
  const cache = new Map(BOARDS.map((b) => [b, scene(b)]))

  for (const name of BOARDS) {
    const s = cache.get(name) as TraceScene

    it(`${name}: every seg grows inside the signal act and names a real group`, () => {
      for (const layer of s.layers) {
        expect(layer.groups.length).toBe(layer.segs.length / 7)
        for (let i = 0; i < layer.groups.length; i++) {
          const g = layer.groups[i] as number
          expect(g === -1 || (g >= 0 && g < s.groups.length)).toBe(true)
          const t0 = layer.segs[i * 7 + 5] as number
          const t1 = layer.segs[i * 7 + 6] as number
          expect(t0).toBeGreaterThanOrEqual(TRACE_ACTS.signal[0] - 1e-9)
          expect(t1).toBeLessThanOrEqual(TRACE_ACTS.signal[1] + 1e-9)
          expect(t1).toBeGreaterThanOrEqual(t0)
        }
      }
    })

    it(`${name}: pulses ride after their unit has grown and stop before the mask pours`, () => {
      for (const g of s.groups) {
        for (const p of g.pulses) {
          expect(p).toBeGreaterThan(g.t + g.d)
          expect(p).toBeLessThan(TRACE_ACTS.mask[0])
        }
      }
    })

    it(`${name}: shots ascend, cut on the act changes and land on a sharp three-quarter hero`, () => {
      expect(s.shots[0]?.t).toBe(0)
      expect(s.shots.at(-1)?.t).toBe(1)
      for (let i = 1; i < s.shots.length; i++) expect((s.shots[i] as { t: number }).t).toBeGreaterThan((s.shots[i - 1] as { t: number }).t)
      expect(s.shots.filter((k) => k.cut === true).length).toBeGreaterThanOrEqual(3)
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

    it(`${name}: parts land after the mask, the hero first`, () => {
      expect(s.parts.length).toBeGreaterThan(0)
      const hero = s.parts.filter((pt) => pt.hero === true)
      expect(hero.length).toBeLessThanOrEqual(1)
      for (const pt of s.parts) {
        if (pt.hero === true) expect(pt.t).toBe(TRACE_ACTS.land[1])
        else {
          expect(pt.t).toBeGreaterThanOrEqual(TRACE_ACTS.place[0])
          expect(pt.t).toBeLessThanOrEqual(TRACE_ACTS.place[1])
        }
        expect(pt.w).toBeGreaterThan(0)
        expect(pt.z).toBeGreaterThan(0)
      }
    })

    it(`${name}: one stack label per copper layer`, () => {
      expect(s.stack.labels.length).toBe(s.layers.length)
      expect(s.stack.gap).toBeGreaterThan(0)
    })

    it(`${name}: the board area is closed loops`, () => {
      expect(s.board.length).toBeGreaterThan(0)
      for (const loop of s.board) expect(loop.length).toBeGreaterThanOrEqual(6)
    })
  }

  it('a bus leaves together and lands together — length-matched lines arrive on one frame', () => {
    const s = cache.get('glasgow') as TraceScene
    const bus = s.groups.findIndex((g) => g.kind === 'bus')
    expect(bus).toBeGreaterThanOrEqual(0)
    const g = s.groups[bus] as TraceScene['groups'][number]
    let first = Infinity
    let last = -Infinity
    for (const layer of s.layers) {
      layer.groups.forEach((gi, i) => {
        if (gi !== bus) return
        first = Math.min(first, layer.segs[i * 7 + 5] as number)
        last = Math.max(last, layer.segs[i * 7 + 6] as number)
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
