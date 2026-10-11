import type { CameraShot } from '../types'

/**
 * The trace camera. The board lies in its zoom-1 frame px (y down) at z = 0;
 * world is x right, y up (= −plane y), z toward the viewer. Shared by the
 * score (to frame shots exactly) and the renderer (to draw them).
 */
export type V3 = [number, number, number]

export const FOV = (30 * Math.PI) / 180

export interface Cam {
  pos: V3
  f: V3
  r: V3
  u: V3
  dist: number
  tanX: number
  tanY: number
  /** column-major view-projection */
  vp: Float32Array
  aperture: number
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

const SHOT_KEYS = ['x', 'y', 'zoom', 'tilt', 'yaw', 'aperture'] as const

/**
 * Monotone cubic through the shot keys: the camera glides through a key when
 * the move continues and settles on it when the move turns around. A key
 * marked `cut` is a hard cut: the previous shot holds its last key until the
 * cut, and no curve is drawn across it.
 */
export function sampleShot(shots: CameraShot[], p: number): Omit<CameraShot, 't' | 'cut'> {
  const out = { x: 0, y: 0, zoom: 1, tilt: 0, yaw: 0, aperture: 0 }
  if (shots.length === 0) return out
  let k = 0
  while (k + 1 < shots.length && (shots[k + 1] as CameraShot).t <= p) k++
  const a = shots[k] as CameraShot
  const nb = shots[k + 1]
  const b = nb === undefined || nb.cut === true ? a : nb
  const h = b.t - a.t
  const u = h > 0 ? Math.min(1, Math.max(0, (p - a.t) / h)) : 0
  const inShot = (i: number): CameraShot | undefined => {
    const s = shots[i]
    return s
  }
  for (const key of SHOT_KEYS) {
    const slope = (i: number): number => {
      const cur = inShot(i)
      const prev = inShot(i - 1)
      const next = inShot(i + 1)
      // a cut on either side makes this key an end of its shot: it settles
      if (cur === undefined || prev === undefined || next === undefined || cur.cut === true || next.cut === true) return 0
      const d0 = (cur[key] - prev[key]) / Math.max(1e-6, cur.t - prev.t)
      const d1 = (next[key] - cur[key]) / Math.max(1e-6, next.t - cur.t)
      return d0 * d1 <= 0 ? 0 : (2 * d0 * d1) / (d0 + d1)
    }
    const m0 = b === a ? 0 : slope(k) * h
    const m1 = b === a ? 0 : slope(k + 1) * h
    const u2 = u * u
    const u3 = u2 * u
    out[key] = (2 * u3 - 3 * u2 + 1) * a[key] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b[key] + (u3 - u2) * m1
  }
  return out
}

export function makeCam(shot: Omit<CameraShot, 't' | 'cut'>, W: number, H: number): Cam {
  const tanY = Math.tan(FOV / 2)
  const tanX = tanY * (W / H)
  const dist = H / 2 / tanY / Math.max(0.05, shot.zoom)
  const T: V3 = [shot.x, -shot.y, 0]
  const st = Math.sin(shot.tilt)
  const pos: V3 = [T[0] + dist * st * Math.sin(shot.yaw), T[1] - dist * st * Math.cos(shot.yaw), dist * Math.cos(shot.tilt)]
  const f = norm(sub(T, pos))
  const r: V3 = [Math.cos(shot.yaw), Math.sin(shot.yaw), 0]
  const u = norm(cross(r, f))
  const near = dist * 0.02
  const far = dist * 20
  const view = [
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -dot(r, pos), -dot(u, pos), dot(f, pos), 1
  ]
  const py = 1 / tanY
  const px = 1 / tanX
  const proj = [px, 0, 0, 0, 0, py, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]
  const vp = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 4; rr++) {
      let s = 0
      for (let i = 0; i < 4; i++) s += (proj[i * 4 + rr] as number) * (view[c * 4 + i] as number)
      vp[c * 4 + rr] = s
    }
  }
  return { pos, f, r, u, dist, tanX, tanY, vp, aperture: shot.aperture }
}

/** NDC of a plane point (px, y down) at height z; w ≤ 0 means behind the camera */
export function project(cam: Cam, x: number, y: number, z = 0): { x: number; y: number; w: number } {
  const v = [x, -y, z, 1]
  const o = [0, 1, 3].map((r) => [0, 1, 2, 3].reduce((s, c) => s + (cam.vp[c * 4 + r] as number) * (v[c] as number), 0))
  const w = o[2] as number
  return { x: (o[0] as number) / w, y: (o[1] as number) / w, w }
}

/**
 * The zoom that fits these points inside an NDC box (±mx, ±my), centred on
 * the shot's look-at point: the largest zoom where every point projects in.
 */
export function fitZoom(
  shot: Omit<CameraShot, 't' | 'cut' | 'zoom'>,
  pts: Array<[number, number, number]>,
  W: number,
  H: number,
  mx: number,
  my: number,
  lo = 0.2,
  hi = 6
): number {
  const fits = (z: number): boolean => {
    const cam = makeCam({ ...shot, zoom: z }, W, H)
    return pts.every(([x, y, zz]) => {
      const q = project(cam, x, y, zz)
      return q.w > 0 && Math.abs(q.x) <= mx && Math.abs(q.y) <= my
    })
  }
  if (!fits(lo)) return lo
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
}
