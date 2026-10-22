// Pure drawing math for the footer figure, shared by figure/build.mjs (static markup) and figure.ts (live frames).
// Plan coordinates: u along the word, v toward the back of the bench, z up. The kit's world is [x, y, z] = [-v, -u, z].

type V2 = readonly [number, number]
export interface Cam { origin: V2; k: number; sinA: number; cosA: number; sinE: number; cosE: number }
export type Seg =
  | { kind: 'line'; a: V2; b: V2; s0: number; s1: number }
  | { kind: 'arc'; c: V2; r: number; a0: number; sweep: number; s0: number; s1: number }
export interface Film { pitch: number; z: V2; length: number; segs: readonly Seg[]; perf: { w: number; h: number; inset: number }; frame: { gap: number; inset: number } }
export interface Roller { u: number; v: number; r: number; dir: number; teeth: number; z: V2; cap: number; slot: number; phase: number; crank: { r: number; z: number } | null }
export interface Pack { u: number; v: number; r: number; dir: number; holes: { r: number; size: number; z: number }; keys: { r: number; z: number } }

type Pt = [number, number]
const TAU = Math.PI * 2

export function project(cam: Cam, u: number, v: number, z: number): Pt {
  const x = -v
  const y = -u
  return [cam.origin[0] + (x * cam.sinA - y * cam.cosA) * cam.k, cam.origin[1] + ((x * cam.cosA + y * cam.sinA) * cam.sinE - z * cam.cosE) * cam.k]
}

const f1 = (n: number) => {
  const t = (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '')
  return t === '-0' ? '0' : t
}
export const pathOf = (pts: readonly Pt[], closed = false) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join('') + (closed ? 'Z' : '')

export function pointAt(segs: readonly Seg[], s: number): Pt {
  const seg = segs.find((g) => s <= g.s1 + 1e-9) ?? segs[segs.length - 1]
  if (!seg) return [0, 0]
  const t = (s - seg.s0) / (seg.s1 - seg.s0 || 1)
  if (seg.kind === 'line') return [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t]
  const a = seg.a0 + seg.sweep * t
  return [seg.c[0] + seg.r * Math.cos(a), seg.c[1] + seg.r * Math.sin(a)]
}

/** quads that run along the film between s0 and s1, one per repeat of `pitch` centred at centre + adv + m·pitch, cut to the span */
function spanQuads(cam: Cam, film: Film, s0: number, s1: number, adv: number, centre: number, half: number, bands: readonly V2[]) {
  const out: string[] = []
  const first = Math.floor((s0 - centre - adv - half) / film.pitch)
  for (let m = first; ; m++) {
    const c = centre + adv + m * film.pitch
    if (c - half > s1) break
    const a = Math.max(s0, c - half)
    const b = Math.min(s1, c + half)
    if (b <= a) continue
    const n = Math.max(1, Math.ceil((b - a) / 1.5))
    const line = Array.from({ length: n + 1 }, (_, i) => pointAt(film.segs, a + ((b - a) * i) / n))
    for (const [z0, z1] of bands) out.push(pathOf([...line.map(([u, v]) => project(cam, u, v, z0)), ...[...line].reverse().map(([u, v]) => project(cam, u, v, z1))], true))
  }
  return out.join('')
}

export function perfs(cam: Cam, film: Film, s0: number, s1: number, adv: number) {
  const { w, h, inset } = film.perf
  const [lo, hi] = film.z
  return spanQuads(cam, film, s0, s1, adv, 0, w / 2, [[lo + inset, lo + inset + h], [hi - inset - h, hi - inset]])
}

export function frames(cam: Cam, film: Film, s0: number, s1: number, adv: number) {
  return spanQuads(cam, film, s0, s1, adv, film.pitch / 2, film.pitch / 2 - film.frame.gap / 2, [[film.z[0] + film.frame.inset, film.z[1] - film.frame.inset]])
}

/** how squarely a vertical surface whose plan normal is at angle a faces the viewer */
const facing = (cam: Cam, a: number) => (-Math.sin(a) * cam.cosA - Math.cos(a) * cam.sinA) * cam.cosE

/** the sprocket teeth on a drum's visible half, turned to `angle` */
export function teeth(cam: Cam, r: Roller, angle: number) {
  const out: string[] = []
  const rad = r.r - 0.15
  const half = 0.55 / rad
  const rows: V2[] = [[r.z[0] + 0.45, r.z[0] + 1.25], [r.z[1] - 1.25, r.z[1] - 0.45]]
  for (let i = 0; i < r.teeth; i++) {
    const a = angle + (i * TAU) / r.teeth
    if (facing(cam, a) <= 0.02) continue
    const at = (b: number, z: number) => project(cam, r.u + rad * Math.cos(b), r.v + rad * Math.sin(b), z)
    for (const [z0, z1] of rows) out.push(pathOf([at(a - half, z0), at(a + half, z0), at(a + half, z1), at(a - half, z1)], true))
  }
  return out.join('')
}

/** the screwdriver slot on a roller's cap */
export function slot(cam: Cam, r: Roller, angle: number) {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const w = 0.28
  const corners: Pt[] = [[-r.slot, -w], [r.slot, -w], [r.slot, w], [-r.slot, w]]
  return pathOf(corners.map(([x, y]) => project(cam, r.u + x * c - y * s, r.v + x * s + y * c, r.cap)), true)
}

/** the three lightening holes in a platter and the three key slots in its core */
export function holes(cam: Cam, p: Pack, angle: number) {
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * TAU) / 3
    const cu = p.u + p.holes.r * Math.cos(a)
    const cv = p.v + p.holes.r * Math.sin(a)
    out.push(pathOf(Array.from({ length: 18 }, (_, j) => project(cam, cu + p.holes.size * Math.cos((j * TAU) / 18), cv + p.holes.size * Math.sin((j * TAU) / 18), p.holes.z)), true))
  }
  return out.join('')
}

export function keys(cam: Cam, p: Pack, angle: number) {
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * TAU) / 3 + Math.PI / 3
    const c = Math.cos(a)
    const s = Math.sin(a)
    const corners: Pt[] = [[p.keys.r - 3.4, -0.7], [p.keys.r - 0.6, -0.7], [p.keys.r - 0.6, 0.7], [p.keys.r - 3.4, 0.7]]
    out.push(pathOf(corners.map(([x, y]) => project(cam, p.u + x * c - y * s, p.v + x * s + y * c, p.keys.z)), true))
  }
  return out.join('')
}

/** where the crank handle sits at `angle`, as a screen offset from where it was drawn (angle 0) */
export function crankOffset(cam: Cam, r: Roller, angle: number): Pt {
  if (!r.crank) return [0, 0]
  const rest = project(cam, r.u + r.crank.r, r.v, r.crank.z)
  const now = project(cam, r.u + r.crank.r * Math.cos(angle), r.v + r.crank.r * Math.sin(angle), r.crank.z)
  return [now[0] - rest[0], now[1] - rest[1]]
}

/** a roller's angle when the film has advanced `s`: its surface moves with the film */
export const rollerAngle = (r: Roller, s: number) => r.phase + (r.dir * s) / r.r
export const packAngle = (p: Pack, s: number) => (p.dir * s) / p.r

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** the number wheels: each frame they roll from the last reading to this one in the first third of the frame, 335 rolls on to 000 */
export function wheels(frame: number, frames: number, cols: number): number[] {
  const n = Math.floor(frame)
  const e = ease((frame - n) / 0.34)
  const now = ((n % frames) + frames) % frames
  const prev = (now + frames - 1) % frames
  return Array.from({ length: cols }, (_, i) => {
    const place = 10 ** (cols - 1 - i)
    const a = Math.floor(prev / place) % 10
    const b = Math.floor(now / place) % 10
    return a + (((b - a) % 10) + 10) % 10 * e
  })
}
