import type { FlatPath, TraceGroup, TraceScene, TraceTimeline } from '@silk-reel/choreo'
import { FONT } from './font'

/**
 * Board-space data maps for the lit renderer. Nothing here is colour: each
 * canvas packs three scalar fields into R/G/B (drawn with 'lighter' so the
 * channels never bleed), and the shader turns them into copper, mask, ink
 * and light. The maps cover only `region` (plane px) — the part of the board
 * the camera can see — so a macro shot gets texels where it needs them.
 *
 *   top:    R copper (front)   G exposed pad   B energy (front)
 *   surf:   R silk ink         G drilled hole  B board area
 *   stack:  R/G/B copper of the inner and back layers (exploded act only)
 *   stackE: R/G/B energy of the same
 */
export interface Region { x: number; y: number; w: number; h: number }

export interface MapSet {
  top: HTMLCanvasElement
  surf: HTMLCanvasElement
  stack: HTMLCanvasElement
  stackE: HTMLCanvasElement
}

const ease = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const within = (p: number, a: number, b: number): number => ease((p - a) / (b - a))

export function createMaps(w: number, h: number): MapSet {
  const make = (): HTMLCanvasElement => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return { top: make(), surf: make(), stack: make(), stackE: make() }
}

const CH = ['rgba(255,0,0,', 'rgba(0,255,0,', 'rgba(0,0,255,'] as const
const ink = (ch: 0 | 1 | 2, a = 1): string => `${CH[ch]}${Math.max(0, Math.min(1, a)).toFixed(4)})`

function begin(c: HTMLCanvasElement, r: Region): CanvasRenderingContext2D {
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, c.width, c.height)
  const s = c.width / r.w
  ctx.setTransform(s, 0, 0, s, -r.x * s, -r.y * s)
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return ctx
}

const poly = (ctx: CanvasRenderingContext2D | Path2D, path: FlatPath): void => {
  ctx.moveTo(path[0] as number, path[1] as number)
  for (let i = 2; i + 1 < path.length; i += 2) ctx.lineTo(path[i] as number, path[i + 1] as number)
}

/** how far (px) energy trails behind a moving head, in film phase */
const TAIL = 0.014

/**
 * Energy along a seg for a front that crosses it during [w0, w1]: a streak
 * from the tail to the head, brightest at the head. Fronts spill across seg
 * boundaries because every seg draws its own slice of the streak.
 */
function streak(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  w: number, w0: number, w1: number, p: number, gain: number
): boolean {
  if (p < w0 || p > w1 + TAIL) return false
  const span = Math.max(1e-6, w1 - w0)
  const hf = Math.min(1, (p - w0) / span)
  const tf = Math.max(0, (p - TAIL - w0) / span)
  if (hf <= tf) return false
  const hx = x0 + (x1 - x0) * hf
  const hy = y0 + (y1 - y0) * hf
  const tx = x0 + (x1 - x0) * tf
  const ty = y0 + (y1 - y0) * tf
  // once the front has left this seg, its slice of the streak dims with the tail
  const headA = hf >= 1 ? gain * (1 - (p - w1) / TAIL) : gain
  const grad = ctx.createLinearGradient(tx, ty, hx, hy)
  grad.addColorStop(0, ink(2, 0))
  grad.addColorStop(1, ink(2, headA))
  ctx.strokeStyle = grad
  ctx.lineWidth = w * 1.5
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  return hf < 1
}

const padPath = (ctx: CanvasRenderingContext2D, w: number, h: number, shape: 'rect' | 'round' | 'circle'): void => {
  ctx.beginPath()
  if (shape === 'circle') ctx.arc(0, 0, Math.max(w, h) / 2, 0, Math.PI * 2)
  else if (shape === 'round' && typeof ctx.roundRect === 'function') ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.32)
  else ctx.rect(-w / 2, -h / 2, w, h)
}

interface LayerDraw {
  ctx: CanvasRenderingContext2D
  /** copper channel */
  cu: 0 | 1 | 2
  /** energy canvas + channel */
  ectx: CanvasRenderingContext2D
  e: 0 | 1 | 2
}

function drawCopperLayer(
  d: LayerDraw,
  segs: number[],
  groups: number[],
  scene: TraceScene,
  p: number,
  drawEnergy: boolean
): void {
  const { ctx, cu, ectx, e } = d
  const batches = new Map<number, Path2D>()
  const n = segs.length / 7
  for (let i = 0; i < n; i++) {
    const o = i * 7
    const t0 = segs[o + 5] as number
    if (t0 > p) break
    const x0 = segs[o] as number
    const y0 = segs[o + 1] as number
    const x1 = segs[o + 2] as number
    const y1 = segs[o + 3] as number
    const w = segs[o + 4] as number
    const t1 = segs[o + 6] as number
    if (t1 <= p) {
      const key = Math.round(w * 4) / 4
      let path = batches.get(key)
      if (path === undefined) {
        path = new Path2D()
        batches.set(key, path)
      }
      path.moveTo(x0, y0)
      path.lineTo(x1, y1)
    } else {
      const f = (p - t0) / Math.max(1e-6, t1 - t0)
      ctx.strokeStyle = ink(cu)
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f)
      ctx.stroke()
    }
  }
  ctx.strokeStyle = ink(cu)
  for (const [w, path] of batches) {
    ctx.lineWidth = w
    ctx.stroke(path)
  }
  if (!drawEnergy) return

  for (let i = 0; i < n; i++) {
    const o = i * 7
    const t0 = segs[o + 5] as number
    if (t0 > p) break
    const x0 = segs[o] as number
    const y0 = segs[o + 1] as number
    const x1 = segs[o + 2] as number
    const y1 = segs[o + 3] as number
    const w = segs[o + 4] as number
    const t1 = segs[o + 6] as number
    const grp: TraceGroup | undefined = scene.groups[groups[i] as number]
    // the growth front itself
    // the cast parts burn bright; background nets glow just enough to read
    const gain = grp === undefined ? 0.3 : grp.kind === 'clock' ? 1 : grp.kind === 'bus' || grp.kind === 'diff' ? 0.9 : grp.kind === 'signal' ? 0.32 : 0.22
    streak(ectx, x0, y0, x1, y1, w, t0, t1, p, gain)
    if (grp === undefined) continue
    // arrival: the unit's last segs flash where they land — a bus lands all at once
    const end = grp.t + grp.d
    if ((grp.kind === 'bus' || grp.kind === 'diff' || grp.kind === 'clock') && t1 >= end - 1e-4 && p >= t1 && p < t1 + 0.03) {
      const k = 1 - (p - t1) / 0.03
      ectx.fillStyle = ink(e, k * k)
      ectx.beginPath()
      ectx.arc(x1, y1, Math.max(2.5, w * 2.6), 0, Math.PI * 2)
      ectx.fill()
    }
    // pulses replay the growth front faster, on the bar lines
    if (grp.pulses.length === 0 || t1 > p) continue
    const k = 1 / grp.pulseSpeed
    for (const s of grp.pulses) {
      const w0 = s + (t0 - grp.t) * k
      const w1 = s + (t1 - grp.t) * k
      if (p < w0 || p > w1 + TAIL) continue
      streak(ectx, x0, y0, x1, y1, w, w0, w1, p, grp.kind === 'signal' ? 0.55 : 0.85)
    }
  }
}

function zonePaths(
  ctx: CanvasRenderingContext2D, scene: TraceScene, side: 'F' | 'B' | 'inner', p: number, ch: 0 | 1 | 2,
  ectx: CanvasRenderingContext2D | undefined, e: 0 | 1 | 2, reachMax: number
): void {
  for (const zone of scene.zones) {
    if (zone.side !== side) continue
    const f = within(p, zone.t0, zone.t1)
    if (f <= 0) continue
    // pours flood outward from the hero, a bright ring riding the front
    const reach = f * reachMax
    ctx.save()
    const clip = new Path2D()
    poly(clip, zone.fill)
    ctx.clip(clip)
    ctx.beginPath()
    ctx.arc(scene.origin.x, scene.origin.y, reach, 0, Math.PI * 2)
    ctx.fillStyle = ink(ch, 0.82)
    ctx.fill()
    ctx.restore()
    if (ectx !== undefined && f < 1) {
      ectx.save()
      ectx.clip(clip)
      ectx.strokeStyle = ink(e, 0.55 * (1 - f))
      ectx.lineWidth = 7
      ectx.beginPath()
      ectx.arc(scene.origin.x, scene.origin.y, reach, 0, Math.PI * 2)
      ectx.stroke()
      ectx.restore()
    }
  }
}

function floodRing(ctx: CanvasRenderingContext2D, scene: TraceScene, side: 'F' | 'B' | 'inner', p: number, reachMax: number): void {
  for (const zone of scene.zones) {
    if (zone.side !== side) continue
    const f = within(p, zone.t0, zone.t1)
    if (f <= 0 || f >= 1) continue
    const clip = new Path2D()
    poly(clip, zone.fill)
    ctx.save()
    ctx.clip(clip)
    const r = f * reachMax
    const band = 26
    const grad = ctx.createRadialGradient(scene.origin.x, scene.origin.y, Math.max(0, r - band), scene.origin.x, scene.origin.y, r)
    grad.addColorStop(0, ink(2, 0))
    grad.addColorStop(1, ink(2, 0.4 * (1 - f)))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(scene.origin.x, scene.origin.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** draws every map for film phase p; `stack` maps only when the stack act needs them */
export function drawMaps(maps: MapSet, tl: TraceTimeline, p: number, region: Region, withStack: boolean): void {
  const s = tl.scene
  const top = begin(maps.top, region)
  const topSide = s.layers.some((l) => l.side === 'F') ? 'F' : (s.layers[s.layers.length - 1]?.side ?? 'F')

  // --- front copper + energy
  const reachMax = Math.hypot(tl.width, tl.height)
  zonePaths(top, s, topSide, p, 0, top, 2, reachMax)
  // planes buried in the stack still flood: their front shows through as light
  for (const side of ['inner', 'B'] as const) {
    if (side === topSide) continue
    floodRing(top, s, side, p, reachMax)
  }
  for (const layer of s.layers) {
    if (layer.side !== topSide) continue
    drawCopperLayer({ ctx: top, cu: 0, ectx: top, e: 2 }, layer.segs, layer.groups, s, p, true)
  }
  // pads: copper + exposed finish, a flash as each one lands
  const [hp0, hp1] = s.acts.heroPads
  for (const pad of s.pads) {
    if (p < pad.t) continue
    const front = pad.side !== 'B' || topSide !== 'F'
    if (!front) continue
    const k = ease((p - pad.t) / 0.02)
    const scale = k < 0.7 ? 0.6 + 0.48 * (k / 0.7) : 1.08 - 0.08 * ((k - 0.7) / 0.3)
    top.save()
    top.translate(pad.x, pad.y)
    top.rotate(pad.rot)
    top.scale(scale, scale)
    padPath(top, pad.w, pad.h, pad.shape)
    if (pad.ring === true) {
      top.lineWidth = 1.6
      top.strokeStyle = ink(0)
      top.stroke()
      top.strokeStyle = ink(1)
      top.stroke()
    } else {
      top.fillStyle = 'rgba(255,255,0,1)'
      top.fill()
    }
    // landing flash; the hero's pins keep a low ember through ignition
    const hero = pad.t >= hp0 && pad.t <= hp1 + 1e-9
    const flash = (1 - k) * 0.8 + (hero ? 0.16 * (1 - within(p, s.acts.ignite[1], s.acts.signal[0] + 0.12)) : 0)
    if (flash > 0.01) {
      top.fillStyle = ink(2, flash)
      top.fill()
    }
    top.restore()
  }
  // vias: a copper ring, a flash when the front passes
  for (const via of s.vias) {
    if (p < via.t) continue
    top.strokeStyle = ink(0)
    top.lineWidth = Math.max(0.8, via.r * 0.55)
    top.beginPath()
    top.arc(via.x, via.y, via.r * 0.8, 0, Math.PI * 2)
    top.stroke()
    const f = 1 - (p - via.t) / 0.025
    if (f > 0) {
      top.fillStyle = ink(2, f * 0.8)
      top.beginPath()
      top.arc(via.x, via.y, via.r * 1.3, 0, Math.PI * 2)
      top.fill()
    }
  }
  // the outline is traced by a pair of heads in the first beat
  const of = within(p, 0, 0.07)
  if (of > 0 && of < 1) {
    for (const path of s.outline) {
      const len = pathLen(path)
      if (len < 40) continue
      top.save()
      const tail = Math.max(0, of - 0.05)
      top.setLineDash([len * (of - tail), len * 2])
      top.lineDashOffset = -len * tail
      top.strokeStyle = ink(2, 0.9)
      top.lineWidth = 2
      top.beginPath()
      poly(top, path)
      top.stroke()
      top.restore()
    }
  }

  // --- surface: silk, holes, board area
  const surf = begin(maps.surf, region)
  const area = new Path2D()
  for (const loop of s.board) {
    poly(area, loop)
    area.closePath()
  }
  surf.fillStyle = ink(2)
  surf.fill(area, 'evenodd')
  surf.fillStyle = ink(1)
  for (const d of s.drills) {
    surf.beginPath()
    surf.arc(d.x, d.y, d.r, 0, Math.PI * 2)
    surf.fill()
  }
  surf.strokeStyle = ink(0)
  surf.lineWidth = 1.1
  const silkDone = new Path2D()
  for (const stroke of s.silkStrokes) {
    const f = ease((p - stroke.t) / 0.03)
    if (f <= 0) continue
    if (f >= 1) {
      poly(silkDone, stroke.path)
      continue
    }
    const len = Math.max(1, pathLen(stroke.path))
    surf.setLineDash([len * f, len])
    surf.beginPath()
    poly(surf, stroke.path)
    surf.stroke()
    surf.setLineDash([])
  }
  surf.stroke(silkDone)
  surf.fillStyle = ink(0)
  surf.textAlign = 'center'
  surf.textBaseline = 'middle'
  for (const text of s.texts) {
    const k = ease((p - text.t) / 0.025)
    if (k <= 0) continue
    const shown = text.text.substring(0, Math.ceil(text.text.length * k))
    if (shown.length === 0) continue
    surf.save()
    surf.translate(text.x, text.y)
    surf.rotate(text.rot)
    surf.font = `${text.size}px ${FONT}`
    surf.fillText(shown, 0, 0)
    surf.restore()
  }

  if (!withStack) return
  // --- inner and back copper for the exploded stack
  const stack = begin(maps.stack, region)
  const stackE = begin(maps.stackE, region)
  const lower = s.layers.filter((l) => l.side !== topSide)
  const inner = lower.filter((l) => l.side === 'inner')
  const chanOf = (side: string, id: string): 0 | 1 | 2 => side === 'B' ? 2 : (inner.findIndex((l) => l.id === id) % 2 === 0 ? 0 : 1)
  for (const layer of lower) {
    const ch = chanOf(layer.side, layer.id)
    zonePaths(stack, s, layer.side, p, ch, undefined, ch, reachMax)
    drawCopperLayer({ ctx: stack, cu: ch, ectx: stackE, e: ch }, layer.segs, layer.groups, s, p, true)
  }
  for (const pad of s.pads) {
    if (p < pad.t || pad.side === 'F') continue
    for (const ch of pad.side === 'both' ? [0, 1, 2] as const : [2] as const) {
      stack.save()
      stack.translate(pad.x, pad.y)
      stack.rotate(pad.rot)
      padPath(stack, pad.w, pad.h, pad.shape)
      stack.fillStyle = ink(ch)
      stack.fill()
      stack.restore()
    }
  }
}

function pathLen(path: FlatPath): number {
  let len = 0
  for (let i = 2; i + 1 < path.length; i += 2) {
    len += Math.hypot((path[i] as number) - (path[i - 2] as number), (path[i + 1] as number) - (path[i - 1] as number))
  }
  return len
}
