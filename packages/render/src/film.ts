import type { BoardModel, Vec2 } from '@silk-reel/ingest'
import { sampleDirectedKeyframes } from '@silk-reel/choreo/sample-directed'
import type { CastRole, CastUnit, FilmShot, Timeline, UnitTrack } from '@silk-reel/choreo'

export interface Geom {
  kind: 'trace' | 'pad' | 'via' | 'zone' | 'text' | 'drill' | 'outline'
  shape?: string
  x0: number
  y0: number
  x1: number
  y1: number
  draw(ctx: CanvasRenderingContext2D, strokeScale?: number): void
}

export interface GeometryLookup {
  get(id: string): Geom | undefined
}

export interface ViewBox {
  scale: number
  offsetX: number
  offsetY: number
}

function traceGeom(_id: string, points: Vec2[], width: number): Geom | undefined {
  if (points.length === 0) return undefined
  const stroke = Math.max(width, 0.22)
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
    draw(ctx, strokeScale = 1) {
      ctx.lineWidth = stroke * strokeScale
      ctx.stroke(path)
    }
  }
}

function padGeom(_id: string, pos: Vec2, size: Vec2, shape: string, rotation: number): Geom {
  const hw = Math.max(size.x, 0.3) / 2
  const hh = Math.max(size.y, 0.3) / 2
  const r = Math.min(hw, hh)
  const path = new Path2D()
  if (shape === 'circle' || shape === 'oval') {
    path.arc(0, 0, r, 0, Math.PI * 2)
  } else if (shape === 'roundrect') {
    const corner = Math.min(r * 0.42, 0.8)
    path.moveTo(-hw + corner, -hh)
    path.lineTo(hw - corner, -hh)
    path.quadraticCurveTo(hw, -hh, hw, -hh + corner)
    path.lineTo(hw, hh - corner)
    path.quadraticCurveTo(hw, hh, hw - corner, hh)
    path.lineTo(-hw + corner, hh)
    path.quadraticCurveTo(-hw, hh, -hw, hh - corner)
    path.lineTo(-hw, -hh + corner)
    path.quadraticCurveTo(-hw, -hh, -hw + corner, -hh)
  } else if (shape === 'trapezoid') {
    const skew = Math.min(hw * 0.26, 0.8)
    path.moveTo(-hw + skew, -hh)
    path.lineTo(hw - skew, -hh)
    path.lineTo(hw + skew, hh)
    path.lineTo(-hw - skew, hh)
    path.closePath()
  } else {
    path.rect(-hw, -hh, hw * 2, hh * 2)
  }
  return {
    kind: 'pad',
    shape,
    x0: pos.x - hw,
    y0: pos.y - hh,
    x1: pos.x + hw,
    y1: pos.y + hh,
    draw(ctx, strokeScale = 1) {
      ctx.save()
      ctx.translate(pos.x, pos.y)
      ctx.rotate((rotation * Math.PI) / 180)
      if (shape === 'oval' && Math.abs(hw - hh) >= 0.05) ctx.scale(hw / r, hh / r)
      ctx.lineWidth = 0.36 * strokeScale
      ctx.stroke(path)
      if (shape === 'rect') {
        const mark = Math.max(Math.min(hw, hh) * 0.18, 0.08)
        ctx.fillRect(-mark, -mark, mark * 2, mark * 2)
      }
      ctx.restore()
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
    draw(ctx, strokeScale = 1) {
      ctx.lineWidth = 0.22 * strokeScale
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
    draw(ctx, strokeScale = 1) {
      ctx.globalAlpha *= 0.1
      ctx.lineWidth = 0.1 * strokeScale
      ctx.stroke(path)
      ctx.globalAlpha /= 0.1
    }
  }
}

function textGeom(_id: string, value: string, pos: Vec2, height: number, rotation: number): Geom {
  const inkHeight = Math.max(height * 0.9, 0.42)
  const halfW = Math.max(value.length * inkHeight * 0.31, inkHeight * 0.6)
  const halfH = inkHeight * 0.65
  return {
    kind: 'text',
    x0: pos.x - halfW,
    y0: pos.y - halfH,
    x1: pos.x + halfW,
    y1: pos.y + halfH,
    draw(ctx) {
      ctx.save()
      ctx.translate(pos.x, pos.y)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${inkHeight}px monospace`
      ctx.fillText(value, 0, 0)
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
    draw(ctx, strokeScale = 1) {
      ctx.lineWidth = 0.16 * strokeScale
      ctx.stroke(path)
    }
  }
}

function outlinePathGeom(_id: string, points: Vec2[], closed: boolean): Geom | undefined {
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
  return {
    kind: 'outline',
    x0: minX,
    y0: minY,
    x1: maxX,
    y1: maxY,
    draw(ctx, strokeScale = 1) {
      ctx.globalAlpha *= 0.28
      ctx.lineWidth = 0.1 * strokeScale
      ctx.stroke(path)
      ctx.globalAlpha /= 0.28
    }
  }
}

function arcGeom(_id: string, center: Vec2, radius: number, startAngle: number, endAngle: number, width: number): Geom {
  const path = new Path2D()
  path.arc(center.x, center.y, radius, startAngle, endAngle)
  return {
    kind: 'trace',
    x0: center.x - radius - width,
    y0: center.y - radius - width,
    x1: center.x + radius + width,
    y1: center.y + radius + width,
    draw(ctx, strokeScale = 1) {
      ctx.lineWidth = Math.max(width, 0.22) * strokeScale
      ctx.stroke(path)
    }
  }
}

function register(map: Map<string, Geom>, id: string, geom: Geom | undefined): void {
  if (geom !== undefined && !map.has(id)) map.set(id, geom)
}

export function buildGeometryLookup(board: BoardModel): GeometryLookup {
  const map = new Map<string, Geom>()
  for (const copper of Object.values(board.copper)) {
    for (const t of copper.traces) register(map, t.id, traceGeom(t.id, t.points, t.width))
    for (const p of copper.pads) register(map, p.id, padGeom(p.id, p.pos, p.size, p.shape, p.rot))
    for (const v of copper.vias) register(map, v.id, viaGeom(v.id, v.pos, v.dia))
    for (const z of copper.zones) register(map, z.id, zoneGeom(z.id, z.outline))
  }
  for (const [, silk] of Object.entries(board.silkscreen)) {
    for (const l of silk.lines) register(map, l.id, traceGeom(l.id, l.points, l.width))
    for (const a of silk.arcs) register(map, a.id, arcGeom(a.id, a.center, a.radius, a.startAngle, a.endAngle, a.width))
    for (const tx of silk.texts) register(map, tx.id, textGeom(tx.id, tx.value, tx.pos, tx.height, tx.rot))
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

function directedShotAt(timeline: Timeline, frame: number): FilmShot | undefined {
  return timeline.shots.find((shot) => frame >= shot.startFrame && frame <= shot.endFrame)
}

function roleAlpha(kind: Geom['kind']): number {
  switch (kind) {
    case 'pad':
      return 1
    case 'text':
      return 1
    case 'trace':
      return 1
    case 'via':
      return 0.72
    case 'drill':
      return 0.62
    case 'outline':
      return 0.22
    case 'zone':
      return 0.08
    default: {
      const never: never = kind
      throw new Error(`unknown geometry kind ${String(never)}`)
    }
  }
}

interface RoleTreatment {
  intensity: number
  opacity: number
  strokeScale: number
  glow: number
}

const ROLE_TREATMENT: Record<CastRole, RoleTreatment> = {
  'hero-body': { intensity: 0.92, opacity: 1, strokeScale: 1.28, glow: 1 },
  detail: { intensity: 0.78, opacity: 0.88, strokeScale: 1, glow: 0.7 },
  'anchor-pad': { intensity: 0.86, opacity: 0.94, strokeScale: 1.1, glow: 0.8 },
  'text-accent': { intensity: 0.68, opacity: 0.72, strokeScale: 0.82, glow: 0.2 },
  'trace-accent': { intensity: 0.56, opacity: 0.58, strokeScale: 0.72, glow: 0.35 }
}

function castBounds(cast: CastUnit[], geometry: GeometryLookup): Geom[] {
  const geoms: Geom[] = []
  for (const unit of cast) {
    for (const ref of unit.memberRefs) {
      const geom = geometry.get(ref)
      if (geom) geoms.push(geom)
    }
  }
  return geoms
}

export function computeCastView(timeline: Timeline, geometry: GeometryLookup): ViewBox {
  const geoms = castBounds(timeline.cast, geometry)
  return computeViewBox(geoms, timeline.width, timeline.height)
}

function directedView(timeline: Timeline, geometry: GeometryLookup): ViewBox {
  return computeCastView(timeline, geometry)
}

export function drawTimelineFrame(
  ctx: CanvasRenderingContext2D,
  input: DrawFrameInput,
  frame: number
): number {
  if (input.timeline.shots.length === 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#050505'
    ctx.fillRect(0, 0, input.timeline.width, input.timeline.height)
    return 0
  }

  const { timeline, geometry } = input
  const width = timeline.width
  const height = timeline.height
  const view = input.view ?? directedView(timeline, geometry)
  const shot = directedShotAt(timeline, frame)
  const castById = new Map(timeline.cast.map((unit) => [unit.id, unit]))

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'

  if (!shot || shot.id === 'black-breath' || shot.id === 'black-cut') {
    return 0
  }

  const exposure = timeline.renderParams.exposure
  const baseLevel = Math.min(255, 255 * exposure)
  const flicker = timeline.renderParams.flicker
  const glowAmount = timeline.renderParams.glow
  const copiesFor = (track: UnitTrack) => track.copies.transforms.length > 0 ? track.copies.transforms : [{ x: 1 as const, y: 1 as const }]
  let drawn = 0

  for (const track of shot.tracks) {
    const unit = castById.get(track.castId)
    if (!unit) continue
    const transform = sampleDirectedKeyframes(track, frame, timeline.renderParams.easing)
    if (!transform || transform.opacity <= 0.002) continue
    const treatment = ROLE_TREATMENT[unit.role]
    const unitCenter = {
      x: (unit.bounds.min.x + unit.bounds.max.x) / 2,
      y: (unit.bounds.min.y + unit.bounds.max.y) / 2
    }
    const jitter = flicker > 0 ? 1 - flicker * 0.35 * pseudoNoise(frame * 13.7 + hashId(unit.id)) : 1
    for (const copy of copiesFor(track)) {
      const targetX = width / 2 + (transform.x * width - width / 2) * copy.x
      const targetY = height / 2 + (transform.y * height - height / 2) * copy.y
      const sx = view.scale * transform.scale * copy.x
      const sy = view.scale * transform.scale * copy.y
      ctx.save()
      ctx.setTransform(sx, 0, 0, sy, targetX - sx * unitCenter.x, targetY - sy * unitCenter.y)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = Math.min(1, transform.opacity * jitter * treatment.opacity)
      const glowStrength = transform.glow * treatment.glow
      if (glowAmount > 0 && glowStrength > 0.05) {
        ctx.shadowColor = glowStrokeColor(timeline, 0.82 * treatment.glow)
        ctx.shadowBlur = 7 * glowAmount * glowStrength
      } else {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
      const ink = tintStroke(timeline, baseLevel * treatment.intensity, 1)
      ctx.strokeStyle = ink
      ctx.fillStyle = ink
      ctx.translate(unitCenter.x, unitCenter.y)
      ctx.rotate((transform.rotation * Math.PI) / 180)
      ctx.translate(-unitCenter.x, -unitCenter.y)
      for (const ref of unit.memberRefs) {
        const geom = geometry.get(ref)
        if (!geom) continue
        ctx.save()
        ctx.globalAlpha = Math.min(1, transform.opacity * jitter * treatment.opacity * roleAlpha(geom.kind))
        geom.draw(ctx, treatment.strokeScale)
        ctx.restore()
        drawn += 1
      }
      ctx.restore()
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
  if (timeline.renderParams.grain > 0) applyGrainOverlay(ctx, width, height, frame, timeline.renderParams.grain)
  return drawn
}
