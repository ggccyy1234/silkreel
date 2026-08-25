import type { BoardModel, Vec2 } from '@silk-reel/ingest'
import type { Timeline, TimelineElement } from '@silk-reel/choreo'

export interface Geom {
  kind: 'trace' | 'pad' | 'via' | 'zone' | 'text' | 'drill' | 'outline'
  x0: number
  y0: number
  x1: number
  y1: number
  draw(ctx: CanvasRenderingContext2D): void
}

export interface GeometryLookup {
  get(id: string): Geom | undefined
}

export interface ViewBox {
  scale: number
  offsetX: number
  offsetY: number
}

function hypot(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

function traceGeom(id: string, points: Vec2[], width: number): Geom | undefined {
  if (points.length === 0) return undefined
  const stroke = Math.max(width, 0.15)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const path = new Path2D()
  const first = points[0]
  if (!first) return undefined
  path.moveTo(first.x, first.y)
  for (const p of points) {
    minX = Math.min(minX, p.x - stroke / 2)
    minY = Math.min(minY, p.y - stroke / 2)
    maxX = Math.max(maxX, p.x + stroke / 2)
    maxY = Math.max(maxY, p.y + stroke / 2)
    path.lineTo(p.x, p.y)
  }
  return {
    kind: 'trace',
    x0: minX,
    y0: minY,
    x1: maxX,
    y1: maxY,
    draw(ctx) {
      ctx.lineWidth = stroke
      ctx.stroke(path)
    }
  }
}

function padGeom(id: string, pos: Vec2, size: Vec2, shape: string): Geom {
  const hw = Math.max(size.x, 0.3) / 2
  const hh = Math.max(size.y, 0.3) / 2
  const r = Math.min(hw, hh)
  const path = new Path2D()
  if ((shape === 'circle' || shape === 'oval') && Math.abs(hw - hh) < 0.05) {
    path.arc(pos.x, pos.y, r, 0, Math.PI * 2)
  } else {
    path.rect(pos.x - hw, pos.y - hh, hw * 2, hh * 2)
  }
  return {
    kind: 'pad',
    x0: pos.x - hw,
    y0: pos.y - hh,
    x1: pos.x + hw,
    y1: pos.y + hh,
    draw(ctx) {
      ctx.fill(path)
    }
  }
}

function viaGeom(_id: string, pos: Vec2, dia: number): Geom {
  const r = Math.max(dia, 0.3) / 2
  const path = new Path2D()
  path.arc(pos.x, pos.y, r, 0, Math.PI * 2)
  return {
    kind: 'via',
    x0: pos.x - r,
    y0: pos.y - r,
    x1: pos.x + r,
    y1: pos.y + r,
    draw(ctx) {
      ctx.stroke(path)
    }
  }
}

function zoneGeom(_id: string, outline: Vec2[]): Geom | undefined {
  if (outline.length === 0) return undefined
  const path = new Path2D()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const first = outline[0]
  if (!first) return undefined
  path.moveTo(first.x, first.y)
  for (const p of outline) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    path.lineTo(p.x, p.y)
  }
  path.closePath()
  return {
    kind: 'zone',
    x0: minX,
    y0: minY,
    x1: maxX,
    y1: maxY,
    draw(ctx) {
      ctx.stroke(path)
    }
  }
}

function textGeom(id: string, value: string, pos: Vec2, height: number): Geom {
  const halfW = Math.max(value.length * height * 0.35, height * 0.6)
  const halfH = height * 0.75
  return {
    kind: 'text',
    x0: pos.x - halfW,
    y0: pos.y - halfH,
    x1: pos.x + halfW,
    y1: pos.y + halfH,
    draw(ctx) {
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${height}px monospace`
      ctx.fillText(value, pos.x, pos.y)
      ctx.restore()
    }
  }
}

function drillGeom(_id: string, pos: Vec2, dia: number): Geom {
  const r = Math.max(dia, 0.3) / 2
  const path = new Path2D()
  path.arc(pos.x, pos.y, r, 0, Math.PI * 2)
  return {
    kind: 'drill',
    x0: pos.x - r,
    y0: pos.y - r,
    x1: pos.x + r,
    y1: pos.y + r,
    draw(ctx) {
      ctx.stroke(path)
    }
  }
}

function outlinePathGeom(id: string, points: Vec2[], closed: boolean): Geom | undefined {
  if (points.length === 0) return undefined
  const path = new Path2D()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const first = points[0]
  if (!first) return undefined
  path.moveTo(first.x, first.y)
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    path.lineTo(p.x, p.y)
  }
  if (closed) path.closePath()
  void id
  return {
    kind: 'outline',
    x0: minX,
    y0: minY,
    x1: maxX,
    y1: maxY,
    draw(ctx) {
      ctx.globalAlpha *= 0.55
      ctx.stroke(path)
      ctx.globalAlpha /= 0.55
    }
  }
}

function arcGeom(id: string, center: Vec2, radius: number, startAngle: number, endAngle: number, width: number): Geom {
  const path = new Path2D()
  path.arc(center.x, center.y, radius, startAngle, endAngle)
  return {
    kind: 'trace',
    x0: center.x - radius - width,
    y0: center.y - radius - width,
    x1: center.x + radius + width,
    y1: center.y + radius + width,
    draw(ctx) {
      ctx.lineWidth = Math.max(width, 0.15)
      ctx.stroke(path)
    }
  }
}

function register(map: Map<string, Geom>, id: string, geom: Geom | undefined): void {
  if (geom !== undefined && !map.has(id)) map.set(id, geom)
}

export function buildGeometryLookup(board: BoardModel): GeometryLookup {
  const map = new Map<string, Geom>()
  for (const [layerId, copper] of Object.entries(board.copper)) {
    for (const t of copper.traces) register(map, t.id, traceGeom(t.id, t.points, t.width))
    for (const p of copper.pads) register(map, p.id, padGeom(p.id, p.pos, p.size, p.shape))
    for (const v of copper.vias) register(map, v.id, viaGeom(v.id, v.pos, v.dia))
    for (const z of copper.zones) register(map, z.id, zoneGeom(z.id, z.outline))
    void layerId
  }
  for (const [, silk] of Object.entries(board.silkscreen)) {
    for (const l of silk.lines) register(map, l.id, traceGeom(l.id, l.points, l.width))
    for (const tx of silk.texts) register(map, tx.id, textGeom(tx.id, tx.value, tx.pos, tx.height))
  }
  for (const o of board.outline) register(map, o.id, outlinePathGeom(o.id, o.points, o.closed))
  for (const d of board.drill) register(map, d.id, drillGeom(d.id, d.pos, d.dia))
  return { get: (id: string) => map.get(id) }
}

export function computeViewBox(geoms: Geom[], width: number, height: number): ViewBox {
  if (geoms.length === 0) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const g of geoms) {
    minX = Math.min(minX, g.x0)
    minY = Math.min(minY, g.y0)
    maxX = Math.max(maxX, g.x1)
    maxY = Math.max(maxY, g.y1)
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 }
  }
  const padMm = 2
  const spanX = maxX - minX + padMm * 2
  const spanY = maxY - minY + padMm * 2
  const scale = Math.min(width / spanX, height / spanY)
  const offsetX = (width - spanX * scale) / 2 - (minX - padMm) * scale
  const offsetY = (height - spanY * scale) / 2 - (minY - padMm) * scale
  return { scale, offsetX, offsetY }
}

export interface FrameTransform {
  opacity: number
  scaleX: number
  scaleY: number
  glow: number
  dx: number
  dy: number
}

type Kf = NonNullable<TimelineElement['keyframes'][number]>

function toTransform(kf: Kf): FrameTransform {
  return { opacity: kf.opacity, scaleX: kf.scaleX, scaleY: kf.scaleY, glow: kf.glow, dx: kf.dx ?? 0, dy: kf.dy ?? 0 }
}

function lerpTransform(a: Kf, b: Kf, t: number): FrameTransform {
  const mix = (p: number, q: number): number => p + (q - p) * t
  return {
    opacity: mix(a.opacity, b.opacity),
    scaleX: mix(a.scaleX, b.scaleX),
    scaleY: mix(a.scaleY, b.scaleY),
    glow: mix(a.glow, b.glow),
    dx: mix(a.dx ?? 0, b.dx ?? 0),
    dy: mix(a.dy ?? 0, b.dy ?? 0)
  }
}

export function sampleKeyframes(el: TimelineElement, frame: number): FrameTransform | undefined {
  const kfs = el.keyframes
  if (kfs.length === 0) return undefined
  const first = kfs[0]
  const last = kfs[kfs.length - 1]
  if (!first || !last) return undefined
  if (frame <= first.frame) return toTransform(first)
  if (frame >= last.frame) return toTransform(last)
  for (let i = 1; i < kfs.length; i++) {
    const prev = kfs[i - 1]
    const cur = kfs[i]
    if (!prev || !cur) continue
    if (frame <= cur.frame) {
      const t = (frame - prev.frame) / Math.max(1e-9, cur.frame - prev.frame)
      return lerpTransform(prev, cur, t)
    }
  }
  return toTransform(last)
}

function tintStroke(timeline: Timeline, level: number, alpha: number): string {
  const stroke = timeline.palette.stroke
  if (stroke.r === null || stroke.g === null || stroke.b === null) {
    const lv = Math.round(level)
    return `rgba(${lv},${lv},${lv},${alpha.toFixed(4)})`
  }
  const maxCh = Math.max(stroke.r, stroke.g, stroke.b)
  const mul = maxCh > 0 ? level / maxCh : 1
  const r = Math.min(255, Math.round(stroke.r * mul))
  const g = Math.min(255, Math.round(stroke.g * mul))
  const b = Math.min(255, Math.round(stroke.b * mul))
  return `rgba(${r},${g},${b},${alpha.toFixed(4)})`
}

function glowStrokeColor(timeline: Timeline, alpha: number): string {
  const hue = timeline.palette.glowHue
  if (hue.r === null || hue.g === null || hue.b === null) {
    return `rgba(200,200,200,${alpha.toFixed(4)})`
  }
  return `rgba(${hue.r},${hue.g},${hue.b},${alpha.toFixed(4)})`
}

function pseudoNoise(x: number): number {
  const s = Math.sin(x) * 43758.5453
  return s - Math.floor(s)
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 997
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

function applyGrainOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frame: number,
  amount: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  let seed = ((frame + 7) * 2654435761) >>> 0
  const amp = amount * 24
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = (((seed >>> 16) & 0xff) / 255 - 0.5) * 2 * amp
    const r = data[i] as number
    const g = data[i + 1] as number
    const b = data[i + 2] as number
    const isBackground = r < 14 && g < 14 && b < 14
    const delta = isBackground ? noise : noise * 0.4
    data[i] = clampByte(r + delta)
    data[i + 1] = clampByte(g + delta)
    data[i + 2] = clampByte(b + delta)
  }
  ctx.putImageData(imageData, 0, 0)
}

export interface DrawFrameInput {
  timeline: Timeline
  geometry: GeometryLookup
  view?: ViewBox
}

export function drawTimelineFrame(
  ctx: CanvasRenderingContext2D,
  input: DrawFrameInput,
  frame: number
): void {
  const { timeline, geometry } = input
  const width = timeline.width
  const height = timeline.height

  const geoms: Geom[] = []
  for (const el of timeline.elements) {
    const g = geometry.get(el.geomRef)
    if (g) geoms.push(g)
  }
  const view = input.view ?? computeViewBox(geoms, width, height)

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, width, height)

  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const exposure = timeline.renderParams.exposure
  const baseLevel = Math.min(190, 88 * exposure)
  const flicker = timeline.renderParams.flicker
  const glowAmount = timeline.renderParams.glow
  const grain = timeline.renderParams.grain

  for (const el of timeline.elements) {
    const transform = sampleKeyframes(el, frame)
    if (transform === undefined || transform.opacity <= 0.002) continue
    const geom = geometry.get(el.geomRef)
    if (geom === undefined) continue

    const noise = pseudoNoise(frame * 7.13 + hashId(el.id))
    const flickMul = flicker > 0 ? 1 - flicker * 0.55 * noise : 1
    const alpha = Math.min(1, transform.opacity * flickMul)
    if (alpha <= 0.004) continue

    const level = baseLevel * (geom.kind === 'text' ? 1.05 : 1)
    const color = tintStroke(timeline, level, 1)

    ctx.globalAlpha = alpha
    if (glowAmount > 0 && transform.glow > 0.05) {
      ctx.shadowColor = glowStrokeColor(timeline, 0.85)
      ctx.shadowBlur = (14 * glowAmount * Math.max(0.4, transform.glow)) / view.scale
    } else {
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.save()
    ctx.translate(el.placement.dx + transform.dx, el.placement.dy + transform.dy)
    if (transform.scaleX !== 1 || transform.scaleY !== 1) {
      const cx = (geom.x0 + geom.x1) / 2
      const cy = (geom.y0 + geom.y1) / 2
      ctx.translate(cx, cy)
      ctx.scale(transform.scaleX, transform.scaleY)
      ctx.translate(-cx, -cy)
    }
    geom.draw(ctx)
    ctx.restore()
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  if (grain > 0) {
    applyGrainOverlay(ctx, width, height, frame, grain)
  }
}
