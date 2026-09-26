import type { FlatPath, TraceTimeline } from '@silk-reel/choreo'
import { FONT } from './font'
import { drawTitle } from './title'

const ease = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const within = (p: number, span: readonly [number, number]): number => ease((p - span[0]) / (span[1] - span[0]))

const pathLength = (path: FlatPath): number => {
  let len = 0
  for (let i = 2; i + 1 < path.length; i += 2) {
    len += Math.hypot((path[i] as number) - (path[i - 2] as number), (path[i + 1] as number) - (path[i - 1] as number))
  }
  return len
}

const tracePath = (ctx: CanvasRenderingContext2D, path: FlatPath): void => {
  ctx.beginPath()
  ctx.moveTo(path[0] as number, path[1] as number)
  for (let i = 2; i + 1 < path.length; i += 2) ctx.lineTo(path[i] as number, path[i + 1] as number)
}

/** progressive draw: shows the first `frac` of the polyline's length */
const strokeReveal = (ctx: CanvasRenderingContext2D, path: FlatPath, frac: number): void => {
  const len = Math.max(1, pathLength(path))
  tracePath(ctx, path)
  ctx.setLineDash([len])
  ctx.lineDashOffset = len * (1 - Math.min(1, frac))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
}

const roundedRect = (ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void => {
  const x = -w / 2
  const y = -h / 2
  const c = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + c, y)
  ctx.lineTo(x + w - c, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + c)
  ctx.lineTo(x + w, y + h - c)
  ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h)
  ctx.lineTo(x + c, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - c)
  ctx.lineTo(x, y + c)
  ctx.quadraticCurveTo(x, y, x + c, y)
  ctx.closePath()
}

const padPath = (ctx: CanvasRenderingContext2D, w: number, h: number, shape: 'rect' | 'round' | 'circle'): void => {
  if (shape === 'circle') {
    ctx.beginPath()
    ctx.arc(0, 0, Math.max(w, h) / 2, 0, Math.PI * 2)
    return
  }
  if (shape === 'round') {
    roundedRect(ctx, w, h, Math.min(w, h) * 0.32)
    return
  }
  ctx.beginPath()
  ctx.rect(-w / 2, -h / 2, w, h)
}

/** first seg index (stride 7) with t0 > p — segs are sorted by t0 */
const liveSegs = (segs: number[], p: number): number => {
  let lo = 0
  let hi = segs.length / 7
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((segs[mid * 7 + 5] as number) <= p) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function drawTraceFrame(ctx: CanvasRenderingContext2D, tl: TraceTimeline, frame: number): number {
  const { scene: s, palette: pal, width: W, height: H } = tl
  const p = frame / tl.totalFrames
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (tl.transparent) ctx.clearRect(0, 0, W, H)
  else {
    ctx.fillStyle = pal.bg
    ctx.fillRect(0, 0, W, H)
  }
  const fade = 1 - within(p, s.beats.fade)
  if (fade <= 0.002) return 0
  const cam = s.camera.from + (s.camera.to - s.camera.from) * ease(p)
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(cam, cam)
  ctx.translate(-W / 2, -H / 2)
  ctx.globalAlpha = fade
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  let drawn = 0

  // 1 outline — dash reveal over the outline beat
  const outlineFrac = within(p, s.beats.outline)
  if (outlineFrac > 0) {
    ctx.strokeStyle = pal.silk
    ctx.lineWidth = Math.max(1.2, W * 0.0013)
    ctx.globalAlpha = fade * 0.9
    for (const path of s.outline) {
      strokeReveal(ctx, path, outlineFrac)
      drawn += 1
    }
  }

  // 1b drill hits — a faint hole constellation fading in with the outline,
  // persisting as texture under the copper
  const drillAlpha = 0.3 * outlineFrac
  if (drillAlpha > 0.001) {
    ctx.fillStyle = pal.copperDim
    ctx.globalAlpha = fade * drillAlpha
    for (const d of s.drills) {
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
      ctx.fill()
      drawn += 1
    }
  }

  // 2 zones — radial wipe clip from the growth origin, low alpha
  for (const zone of s.zones) {
    const frac = within(p, [zone.t0, zone.t1])
    if (frac <= 0) continue
    const r = frac * Math.hypot(W, H)
    ctx.save()
    ctx.beginPath()
    ctx.arc(s.origin.x, s.origin.y, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = pal.copperDim
    ctx.globalAlpha = fade * 0.16
    tracePath(ctx, zone.fill)
    ctx.fill()
    ctx.restore()
    drawn += 1
  }

  // 3 copper layers back -> front; complete segs batched per rounded width,
  // growing segs stroked to their lerp point with a head queued behind them
  // layers run inner -> B -> F, so the last is the topmost — on boards with no
  // F copper the top present side is promoted to the hero color, not dimmed
  const topSide = s.layers.some((l) => l.side === 'F') ? 'F' : (s.layers[s.layers.length - 1]?.side ?? 'F')
  // dense boards smear when every growing seg carries a glowing head — cap to
  // the ones whose seg length clears the 60th percentile
  const segLens: number[] = []
  for (const layer of s.layers) {
    for (let i = 0; i + 3 < layer.segs.length; i += 7) {
      segLens.push(Math.hypot((layer.segs[i + 2] as number) - (layer.segs[i] as number), (layer.segs[i + 3] as number) - (layer.segs[i + 1] as number)))
    }
  }
  segLens.sort((a, b) => a - b)
  const headMinLen = segLens[Math.floor(segLens.length * 0.6)] ?? 0
  const heads: Array<{ x: number; y: number; w: number }> = []
  for (const layer of s.layers) {
    const front = layer.side === topSide
    ctx.strokeStyle = front ? pal.copper : pal.copperDim
    const segs = layer.segs
    const n = liveSegs(segs, p)
    const batches = new Map<number, Path2D>()
    for (let i = 0; i < n; i++) {
      const o = i * 7
      const x0 = segs[o] as number
      const y0 = segs[o + 1] as number
      const x1 = segs[o + 2] as number
      const y1 = segs[o + 3] as number
      const w = segs[o + 4] as number
      const t0 = segs[o + 5] as number
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
        drawn += 1
        continue
      }
      const frac = (p - t0) / Math.max(1e-6, t1 - t0)
      const hx = x0 + (x1 - x0) * frac
      const hy = y0 + (y1 - y0) * frac
      ctx.globalAlpha = fade * (front ? 1 : 0.45)
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(hx, hy)
      ctx.stroke()
      if (Math.hypot(x1 - x0, y1 - y0) >= headMinLen) heads.push({ x: hx, y: hy, w })
      drawn += 1
    }
    ctx.globalAlpha = fade * (front ? 1 : 0.45)
    for (const [w, path] of batches) {
      ctx.lineWidth = w
      ctx.stroke(path)
    }
  }

  // 4 growth heads — bright dots the post pass will bloom
  if (heads.length > 0) {
    ctx.fillStyle = pal.head
    ctx.globalAlpha = fade
    for (const head of heads) {
      ctx.beginPath()
      ctx.arc(head.x, head.y, Math.max(2, head.w * 1.3), 0, Math.PI * 2)
      ctx.fill()
      drawn += 1
    }
  }

  // 5 vias — copper ring once reached, plus a head-colored flash just after
  for (const via of s.vias) {
    if (p < via.t) continue
    ctx.strokeStyle = pal.copper
    ctx.lineWidth = Math.max(0.8, via.r * 0.35)
    ctx.globalAlpha = fade * 0.8
    ctx.beginPath()
    ctx.arc(via.x, via.y, via.r, 0, Math.PI * 2)
    ctx.stroke()
    drawn += 1
    const flash = 1 - (p - via.t) / 0.03
    if (flash > 0) {
      ctx.strokeStyle = pal.head
      ctx.globalAlpha = fade * flash
      ctx.beginPath()
      ctx.arc(via.x, via.y, via.r * 1.4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  // 6 pads — pop in with a slight overshoot
  for (const pad of s.pads) {
    if (p < pad.t) continue
    const k = ease((p - pad.t) / 0.02)
    const scale = k < 0.7 ? 0.6 + 0.48 * (k / 0.7) : 1.08 - 0.08 * ((k - 0.7) / 0.3)
    ctx.save()
    ctx.translate(pad.x, pad.y)
    ctx.rotate(pad.rot)
    ctx.scale(scale, scale)
    padPath(ctx, pad.w, pad.h, pad.shape)
    ctx.fillStyle = pad.side === 'B' ? pal.copperDim : pal.copper
    ctx.globalAlpha = fade * (pad.side === 'B' ? 0.55 : 0.85)
    ctx.fill()
    if (k < 1) {
      ctx.strokeStyle = pal.head
      ctx.lineWidth = 1
      ctx.globalAlpha = fade * 0.5 * (1 - k)
      ctx.stroke()
    }
    ctx.restore()
    drawn += 1
  }

  // 7 silkscreen strokes — quick dash reveal, top to bottom
  ctx.strokeStyle = pal.silk
  ctx.lineWidth = Math.max(1, W * 0.001)
  for (const stroke of s.silkStrokes) {
    const frac = ease((p - stroke.t) / 0.03)
    if (frac <= 0) continue
    ctx.globalAlpha = fade * 0.8
    strokeReveal(ctx, stroke.path, frac)
    drawn += 1
  }

  // 8 labels — type on inside the silk beat
  ctx.fillStyle = pal.silk
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const text of s.texts) {
    const k = ease((p - text.t) / 0.025)
    if (k <= 0) continue
    const shown = text.text.substring(0, Math.ceil(text.text.length * k))
    if (shown.length === 0) continue
    ctx.save()
    ctx.translate(text.x, text.y)
    ctx.rotate(text.rot)
    ctx.font = `${text.size}px ${FONT}`
    ctx.globalAlpha = fade * 0.9
    ctx.fillText(shown, 0, 0)
    ctx.restore()
    drawn += 1
  }

  // 9 glint — a light band sweeps corner to corner during the hold,
  // clipped to the copper by stroking the complete F segments with it
  const [h0, h1] = s.beats.hold
  if (p >= h0 && p <= h1) {
    const g = (p - h0) / (h1 - h0)
    const diag = Math.hypot(W, H)
    const ux = W / diag
    const uy = H / diag
    const band = 0.11 * W
    const c = (-0.15 + 1.3 * g) * diag
    const cx = ux * c
    const cy = uy * c
    const gradient = ctx.createLinearGradient(cx - ux * band, cy - uy * band, cx + ux * band, cy + uy * band)
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(0.5, pal.head)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = fade * 0.3
    ctx.strokeStyle = gradient
    for (const layer of s.layers) {
      if (layer.side !== topSide) continue
      const segs = layer.segs
      const n = liveSegs(segs, p)
      const batches = new Map<number, Path2D>()
      for (let i = 0; i < n; i++) {
        const o = i * 7
        if ((segs[o + 6] as number) > p) continue
        const key = Math.round((segs[o + 4] as number) * 4) / 4
        let path = batches.get(key)
        if (path === undefined) {
          path = new Path2D()
          batches.set(key, path)
        }
        path.moveTo(segs[o] as number, segs[o + 1] as number)
        path.lineTo(segs[o + 2] as number, segs[o + 3] as number)
      }
      for (const [w, path] of batches) {
        ctx.lineWidth = w
        ctx.stroke(path)
      }
    }
    ctx.restore()
  }

  ctx.restore()

  // 10 title card — screen space, after the camera transform is popped
  drawTitle(ctx, tl, p, fade)
  return drawn
}
