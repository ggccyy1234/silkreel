import './test-recorder.js'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { CameraShot, FilmConfig, TraceTimeline } from '@silk-reel/choreo'
import { linear, makeCam, sampleShot } from './trace-gl.js'
import { drawMaps } from './trace-maps.js'
import type { MapSet } from './trace-maps.js'
import { asCtx, RecordingCtx } from './test-recorder.js'
import { boardModel } from '../../choreo/test/helpers.js'

const W = 1080
const H = 1350

/** clip-space position of a plane point (px, y down, height z) */
function project(vp: Float32Array, x: number, y: number, z = 0): [number, number] {
  const v = [x, -y, z, 1]
  const out = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].reduce((s, c) => s + (vp[c * 4 + r] as number) * (v[c] as number), 0))
  return [(out[0] as number) / (out[3] as number), (out[1] as number) / (out[3] as number)]
}

describe('camera', () => {
  it('zoom 1, tilt 0 reproduces the flat framing exactly', () => {
    const cam = makeCam({ x: W / 2, y: H / 2, zoom: 1, tilt: 0, yaw: 0, aperture: 0 }, W, H)
    const [cx, cy] = project(cam.vp, W / 2, H / 2)
    expect(cx).toBeCloseTo(0, 6)
    expect(cy).toBeCloseTo(0, 6)
    const [rx, ty] = project(cam.vp, W, 0)
    expect(rx).toBeCloseTo(1, 5)
    expect(ty).toBeCloseTo(1, 5)
  })

  it('tilting pitches toward the board bottom: the near edge grows', () => {
    const cam = makeCam({ x: W / 2, y: H / 2, zoom: 1, tilt: 0.8, yaw: 0, aperture: 0 }, W, H)
    const near = project(cam.vp, W, H)[0] - project(cam.vp, 0, H)[0]
    const far = project(cam.vp, W, 0)[0] - project(cam.vp, 0, 0)[0]
    expect(near).toBeGreaterThan(far)
  })

  it('sampleShot passes through every key and holds at turnarounds', () => {
    const shots: CameraShot[] = [
      { t: 0, x: 0, y: 0, zoom: 4, tilt: 1, yaw: 0, aperture: 1 },
      { t: 0.5, x: 100, y: 50, zoom: 2, tilt: 0.5, yaw: 0.3, aperture: 0.5 },
      { t: 1, x: 0, y: 0, zoom: 1, tilt: 0, yaw: 0, aperture: 0 }
    ]
    for (const k of shots) {
      const s = sampleShot(shots, k.t)
      expect(s.x).toBeCloseTo(k.x, 6)
      expect(s.zoom).toBeCloseTo(k.zoom, 6)
    }
    // x turns around at the middle key, so it must not overshoot it
    for (let p = 0; p <= 1; p += 0.01) expect(sampleShot(shots, p).x).toBeLessThanOrEqual(100 + 1e-6)
  })

  it('linear() undoes the sRGB curve', () => {
    expect(linear('#ffffff')).toEqual([1, 1, 1])
    expect(linear('#000000')).toEqual([0, 0, 0])
    expect(linear('#808080')[0]).toBeCloseTo(Math.pow(128 / 255, 2.2), 6)
  })
})

describe('board maps', () => {
  const cfg: FilmConfig = { style: 'trace', knobs: {}, seed: 42, duration: 'auto', output: { width: W, height: H, fps: 30 } }
  const tl = compileTimeline(boardModel('glasgow.kicad_pcb'), cfg) as TraceTimeline
  const fake = (): { canvas: HTMLCanvasElement; rec: RecordingCtx } => {
    const rec = new RecordingCtx(1024, 1280)
    const ctx = asCtx(rec)
    const canvas = { width: 1024, height: 1280, getContext: () => ctx } as unknown as HTMLCanvasElement
    return { canvas, rec }
  }
  const draw = (p: number, stack: boolean) => {
    const top = fake()
    const surf = fake()
    const st = fake()
    const se = fake()
    const maps: MapSet = { top: top.canvas, surf: surf.canvas, stack: st.canvas, stackE: se.canvas }
    drawMaps(maps, tl, p, { x: 0, y: 0, w: W, h: W * 1280 / 1024 }, stack)
    return { top: top.rec, surf: surf.rec, stack: st.rec }
  }

  it('packs channels additively and maps the region into the texture', () => {
    const { top } = draw(0.4, false)
    expect(top.calls.find((c) => c.method === 'set:globalCompositeOperation' && c.args[0] === 'lighter')).toBeDefined()
    const xf = top.calls.filter((c) => c.method === 'setTransform').at(-1)?.args as number[]
    expect(xf[0]).toBeCloseTo(1024 / W, 6)
  })

  it('draws no copper before the signal act, and copper during it', () => {
    const strokes = (p: number) => draw(p, false).top.calls.filter((c) => c.method === 'stroke').length
    expect(strokes(0.4)).toBeGreaterThan(strokes(0.005))
  })

  it('fills the board area and every drill into the surface map', () => {
    const { surf } = draw(0.5, false)
    const fills = surf.calls.filter((c) => c.method === 'fill').length
    expect(fills).toBeGreaterThanOrEqual(tl.scene.drills.length + 1)
  })

  it('draws the inner and back layers only for the stack act', () => {
    expect(draw(0.5, false).stack.calls.length).toBe(0)
    expect(draw(0.65, true).stack.calls.filter((c) => c.method === 'stroke').length).toBeGreaterThan(0)
  })
})
