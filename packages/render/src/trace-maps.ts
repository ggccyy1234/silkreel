import type { FlatPath, TraceGroup, TraceScene, TraceTimeline } from '@silk-reel/choreo'
import { FONT } from './font'

/**
 * Board-space data maps for the lit renderer. Nothing here is colour: each
 * canvas packs three scalar fields into R/G/B (drawn with 'lighter' so the
 * channels never bleed), and the shader turns them into copper, mask, ink
 * and light. The maps cover only `region` (plane px) — the part of the board
 * the camera can see — so a macro shot gets texels where it needs them.
 *
 *   top:    R copper (front)    G exposed pad      B warm energy (power, pours, pads)
 *   surf:   R silk ink          G drilled hole     B board area
 *   fx:     R cool energy       G part shadow      B —
 *   stack:  R/G/B copper of the inner and back layers (exploded act only)
 *   stackE: R/G/B energy of the same
 */
export interface Region { x: number; y: number; w: number; h: number }

export interface MapSet {
  top: HTMLCanvasElement
  surf: HTMLCanvasElement
  fx: HTMLCanvasElement
  stack: HTMLCanvasElement
  stackE: HTMLCanvasElement
}

type Ch = 0 | 1 | 2

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
  return { top: make(), surf: make(), fx: make(), stack: make(), stackE: make() }
}

const CH = ['rgba(255,0,0,', 'rgba(0,255,0,', 'rgba(0,0,255,'] as const
const ink = (ch: Ch, a = 1): string => `${CH[ch]}${Math.max(0, Math.min(1, a)).toFixed(4)})`

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

/** an energy target: which canvas and channel a role's light lands in */
interface Light { ctx: CanvasRenderingContext2D; ch: Ch }

/**
 * Energy along a seg for a front that crosses it during [w0, w1]: a streak
 * from the tail to the head, brightest at the head. Fronts spill across seg
 * boundaries because every seg draws its own slice of the streak.
 */
function streak(
  l: Light,
  x0: number, y0: number, x1: number, y1: number,
  w: number, w0: number, w1: number, p: number, gain: number, tail: number
): void {
  if (p < w0 || p > w1 + tail) return
  const span = Math.max(1e-6, w1 - w0)
  const hf = Math.min(1, (p - w0) / span)
  const tf = Math.max(0, (p - tail - w0) / span)
  if (hf <= tf) return
  const hx = x0 + (x1 - x0) * hf
  const hy = y0 + (y1 - y0) * hf
  const tx = x0 + (x1 - x0) * tf
  const ty = y0 + (y1 - y0) * tf
  // once the front has left this seg, its slice of the streak dims with the tail
  const headA = hf >= 1 ? gain * (1 - (p - w1) / tail) : gain
  const grad = l.ctx.createLinearGradient(tx, ty, hx, hy)
  grad.addColorStop(0, ink(l.ch, 0))
  grad.addColorStop(1, ink(l.ch, headA))
  l.ctx.strokeStyle = grad
  l.ctx.lineWidth = w * 1.5
  l.ctx.beginPath()
  l.ctx.moveTo(tx, ty)
  l.ctx.lineTo(hx, hy)
  l.ctx.stroke()
}

const padPath = (ctx: CanvasRenderingContext2D, w: number, h: number, shape: 'rect' | 'round' | 'circle'): void => {
  ctx.beginPath()
  if (shape === 'circle') ctx.arc(0, 0, Math.max(w, h) / 2, 0, Math.PI * 2)
  else if (shape === 'round' && typeof ctx.roundRect === 'function') ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.32)
  else ctx.rect(-w / 2, -h / 2, w, h)
}

/**
 * How each role reads: clocks are short, sharp and cool; buses and pairs
 * are long cool streaks; ordinary nets are a dim warm trickle; power and
 * ground barely glow — they flood instead.
 */
const ROLE_LOOK: Record<TraceGroup['kind'], { cool: boolean; grow: number; pulse: number; tail: number }> = {
  clock: { cool: true, grow: 1, pulse: 0.95, tail: 0.008 },
  bus: { cool: true, grow: 0.7, pulse: 0.6, tail: 0.022 },
  diff: { cool: true, grow: 0.7, pulse: 0.65, tail: 0.016 },
  signal: { cool: false, grow: 0.34, pulse: 0.5, tail: 0.012 },
  power: { cool: false, grow: 0.26, pulse: 0.4, tail: 0.012 },
  ground: { cool: false, grow: 0.2, pulse: 0.3, tail: 0.012 }
}

function drawCopperLayer(
  ctx: CanvasRenderingContext2D,
  cu: Ch,
  warm: Light,
  cool: Light,
  segs: number[],
  groups: number[],
  scene: TraceScene,
  p: number
): void {
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
    const look = ROLE_LOOK[grp?.kind ?? 'signal']
    const light = look.cool ? cool : warm
    streak(light, x0, y0, x1, y1, w, t0, t1, p, look.grow, look.tail)
    if (grp === undefined) continue
    // arrival: a unit's last segs flash where they land — a bus lands all at once
    const end = grp.t + grp.d
    if (look.cool && t1 >= end - 1e-4 && p >= t1 && p < t1 + 0.04) {
      const k = 1 - (p - t1) / 0.04
      light.ctx.fillStyle = ink(light.ch, k * k)
      light.ctx.beginPath()
      light.ctx.arc(x1, y1, Math.max(2.5, w * 2.4) * (1 + (1 - k) * 0.6), 0, Math.PI * 2)
      light.ctx.fill()
    }
    // pulses replay the growth front faster, on the bar lines
    if (grp.pulses.length === 0 || t1 > p) continue
    const k = 1 / grp.pulseSpeed
    for (const s of grp.pulses) {
      const w0 = s + (t0 - grp.t) * k
      const w1 = s + (t1 - grp.t) * k
      if (p < w0 || p > w1 + look.tail) continue
      streak(light, x0, y0, x1, y1, w, w0, w1, p, look.pulse, look.tail)
    }
  }
}

function zonePaths(
  ctx: CanvasRenderingContext2D, scene: TraceScene, side: 'F' | 'B' | 'inner', p: number, ch: Ch,
  light: Light | undefined, reachMax: number, cover: number
): void {
  for (const zone of scene.zones) {
    if (zone.side !== side) continue
    const f = within(p, zone.t0, zone.t1)
    if (f <= 0) continue
    // pours flood outward from the hero, a hot front riding the edge
    const reach = f * reachMax
    const clip = new Path2D()
    poly(clip, zone.fill)
    ctx.save()
    ctx.clip(clip)
    ctx.beginPath()
    ctx.arc(scene.origin.x, scene.origin.y, reach, 0, Math.PI * 2)
    ctx.fillStyle = ink(ch, cover)
    ctx.fill()
    ctx.restore()
    if (light !== undefined && f < 1) frontRing(light, clip, scene, reach, 0.16 * (1 - f))
  }
}

/** a soft band of light just inside a flood's front */
function frontRing(l: Light, clip: Path2D, scene: TraceScene, r: number, a: number): void {
  const band = Math.max(70, r * 0.35)
  l.ctx.save()
  l.ctx.clip(clip)
  const grad = l.ctx.createRadialGradient(scene.origin.x, scene.origin.y, Math.max(0, r - band), scene.origin.x, scene.origin.y, r)
  grad.addColorStop(0, ink(l.ch, 0))
  grad.addColorStop(0.85, ink(l.ch, a))
  grad.addColorStop(1, ink(l.ch, 0))
  l.ctx.fillStyle = grad
  l.ctx.beginPath()
  l.ctx.arc(scene.origin.x, scene.origin.y, r, 0, Math.PI * 2)
  l.ctx.fill()
  l.ctx.restore()
}

function floodRing(l: Light, scene: TraceScene, side: 'F' | 'B' | 'inner', p: number, reachMax: number): void {
  for (const zone of scene.zones) {
    if (zone.side !== side) continue
    const f = within(p, zone.t0, zone.t1)
    if (f <= 0 || f >= 1) continue
    const clip = new Path2D()
    poly(clip, zone.fill)
    frontRing(l, clip, scene, f * reachMax, 0.4 * (1 - f))
  }
}

/** how far a part still has to fall: 1 before it drops, 0 once seated */
export function partDrop(t: number, p: number, hero: boolean): number {
  const dur = hero ? 0.032 : 0.014
  const u = (p - (t - dur)) / dur
  if (u <= 0) return 1
  if (u >= 1) return 0
  return 1 - u * u
}

/** draws every map for film phase p; `stack` maps only when the stack act needs them */
export function drawMaps(maps: MapSet, tl: TraceTimeline, p: number, region: Region, withStack: boolean): void {
  const s = tl.scene
  const top = begin(maps.top, region)
  const fx = begin(maps.fx, region)
  const warm: Light = { ctx: top, ch: 2 }
  const cool: Light = { ctx: fx, ch: 0 }
  const topSide = s.layers.some((l) => l.side === 'F') ? 'F' : (s.layers[s.layers.length - 1]?.side ?? 'F')

  // --- front copper + energy
  const reachMax = Math.hypot(tl.width, tl.height)
  zonePaths(top, s, topSide, p, 0, warm, reachMax, 0.82)
  // planes buried in the stack still flood: their front shows through as light
  for (const side of ['inner', 'B'] as const) {
    if (side !== topSide) floodRing(warm, s, side, p, reachMax)
  }
  for (const layer of s.layers) {
    if (layer.side !== topSide) continue
    drawCopperLayer(top, 0, warm, cool, layer.segs, layer.groups, s, p)
  }
  // pads: copper + exposed finish, a flash as each one lands
  const [hp0, hp1] = s.acts.heroPads
  for (const pad of s.pads) {
    // before the hero seats, its footprint waits as a faint cool outline: the landing mark
    if (p < pad.t && pad.t >= hp0 && pad.t <= hp1 + 1e-9) {
      fx.save()
      fx.translate(pad.x, pad.y)
      fx.rotate(pad.rot)
      padPath(fx, pad.w, pad.h, pad.shape)
      fx.lineWidth = 1.2
      fx.strokeStyle = ink(0, 0.3 + 0.15 * Math.sin(p * 400))
      fx.stroke()
      fx.restore()
      continue
    }
    if (p < pad.t) continue
    if (pad.side === 'B' && topSide === 'F') continue
    const k = ease((p - pad.t) / 0.02)
    const scale = k < 0.7 ? 0.6 + 0.48 * (k / 0.7) : 1.08 - 0.08 * ((k - 0.7) / 0.3)
    top.save()
    top.translate(pad.x, pad.y)
    top.rotate(pad.rot)
    top.scale(scale, scale)
    padPath(top, pad.w, pad.h, pad.shape)
    if (pad.ring === true) {
      top.lineWidth = 1.6
      top.strokeStyle = 'rgba(255,255,0,1)'
      top.stroke()
    } else {
      top.fillStyle = 'rgba(255,255,0,1)'
      top.fill()
    }
    // landing flash; the hero's pins keep a low ember through ignition
    const hero = pad.t >= hp0 && pad.t <= hp1 + 1e-9
    const flash = (1 - k) * 0.8 + (hero ? 0.22 * (1 - within(p, s.acts.ignite[1], s.acts.signal[0] + 0.1)) : 0)
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
      fx.fillStyle = ink(0, f * 0.7)
      fx.beginPath()
      fx.arc(via.x, via.y, via.r * 1.3, 0, Math.PI * 2)
      fx.fill()
    }
  }
  // the outline is traced by heads in the first beat
  const of = within(p, 0, 0.07)
  if (of > 0 && of < 1) {
    for (const path of s.outline) {
      const len = pathLen(path)
      if (len < 40) continue
      fx.save()
      const tail = Math.max(0, of - 0.05)
      fx.setLineDash([len * (of - tail), len * 2])
      fx.lineDashOffset = -len * tail
      fx.strokeStyle = ink(0, 0.75)
      fx.lineWidth = 2
      fx.beginPath()
      poly(fx, path)
      fx.stroke()
      fx.restore()
    }
  }
  // part shadows: a soft dark footprint under every seated or falling body.
  // max-blended, so a crowd of parts never stacks into a black slab
  fx.globalCompositeOperation = 'lighten'
  for (const part of s.parts) {
    const drop = partDrop(part.t, p, part.hero === true)
    if (drop >= 1) continue
    const k = (1 - drop) * Math.min(1, 0.35 + part.z / 30)
    fx.save()
    fx.translate(part.x, part.y)
    fx.rotate(part.rot)
    for (const [grow, a] of [[1.35, 0.16], [1.15, 0.3], [1.0, 0.5]] as const) {
      const pad = Math.min(part.w, part.h) * (grow - 1) + part.z * (grow - 1) * 0.6
      fx.fillStyle = `rgb(0,${Math.round(255 * a * k)},0)`
      fx.fillRect(-part.w / 2 - pad, -part.h / 2 - pad, part.w + 2 * pad, part.h + 2 * pad)
    }
    fx.restore()
  }
  fx.globalCompositeOperation = 'lighter'

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
  // --- inner and back copper for the exploded stack; planes read as translucent film
  const stack = begin(maps.stack, region)
  const stackE = begin(maps.stackE, region)
  const lower = s.layers.filter((l) => l.side !== topSide)
  const inner = lower.filter((l) => l.side === 'inner')
  const chanOf = (side: string, id: string): Ch => side === 'B' ? 2 : (inner.findIndex((l) => l.id === id) % 2 === 0 ? 0 : 1)
  for (const layer of lower) {
    const ch = chanOf(layer.side, layer.id)
    const light: Light = { ctx: stackE, ch }
    zonePaths(stack, s, layer.side, p, ch, undefined, reachMax, 0.32)
    drawCopperLayer(stack, ch, light, light, layer.segs, layer.groups, s, p)
  }
  for (const pad of s.pads) {
    if (p < pad.t || pad.side === 'F') continue
    for (const ch of pad.side === 'both' ? [0, 1, 2] as const : [2] as const) {
      stack.save()
      stack.translate(pad.x, pad.y)
      stack.rotate(pad.rot)
      padPath(stack, pad.w, pad.h, pad.shape)
      if (pad.ring === true) {
        stack.lineWidth = 1.6
        stack.strokeStyle = ink(ch)
        stack.stroke()
      } else {
        stack.fillStyle = ink(ch)
        stack.fill()
      }
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
