import { sampleTrack, safeArea } from '@silk-reel/choreo'
import type { AtomState, GlyphLabel, GlyphTimeline, Timeline } from '@silk-reel/choreo'
import { drawTraceFrame } from './trace-draw'
import { drawTitle } from './title'
import { FONT } from './font'
/** hairline stroke width in output pixels (constant regardless of glyph scale) */
const INK_PX = 1.3
/** fade-to-black window at both loop edges, as a fraction of the loop */
const BREATH = 0.02

export interface GlyphRender {
  path: Path2D | undefined
  text: string | undefined
  labels: GlyphLabel[]
}

export interface Scene {
  glyphs: Map<string, GlyphRender>
}

function smooth01(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

export function buildScene(timeline: Timeline): Scene {
  const glyphs = new Map<string, GlyphRender>()
  if (timeline.style !== 'glyph') return { glyphs }
  for (const glyph of timeline.cast) {
    let path: Path2D | undefined
    if (glyph.strokes.length > 0) {
      path = new Path2D()
      for (const stroke of glyph.strokes) {
        const first = stroke[0]
        if (first === undefined) continue
        path.moveTo(first.x, first.y)
        for (const p of stroke.slice(1)) path.lineTo(p.x, p.y)
      }
    }
    glyphs.set(glyph.id, { path, text: glyph.text, labels: glyph.labels ?? [] })
  }
  return { glyphs }
}

function drawAtom(
  ctx: CanvasRenderingContext2D,
  glyph: GlyphRender,
  atom: AtomState,
  cx: number,
  cy: number,
  stagePx: number
): void {
  ctx.save()
  ctx.translate(cx + atom.x * stagePx, cy + atom.y * stagePx)
  ctx.rotate(atom.rot)
  const sizePx = atom.scale * stagePx
  const fx = atom.flipX === true ? -1 : 1
  const fy = atom.flipY === true ? -1 : 1
  ctx.scale(sizePx * fx, sizePx * fy)
  if (glyph.text !== undefined) {
    ctx.font = `1px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph.text, 0, 0)
  } else {
    if (glyph.path !== undefined) {
      ctx.lineWidth = INK_PX / sizePx
      ctx.stroke(glyph.path)
    }
    // silkscreen labels ride inside the outline; mirroring them is the style.
    // below 9px they smear into noise — drop them instead
    for (const label of glyph.labels) {
      if (label.size * sizePx < 9) continue
      ctx.save()
      ctx.translate(label.x, label.y)
      ctx.rotate(label.rot)
      ctx.font = `${label.size}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label.text, 0, 0)
      ctx.restore()
    }
  }
  ctx.restore()
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  scene: Scene,
  frame: number
): number {
  if (timeline.style === 'trace') return drawTraceFrame(ctx, timeline, frame)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = timeline.palette.bg
  ctx.fillRect(0, 0, timeline.width, timeline.height)
  return drawGlyphFrame(ctx, timeline, scene, frame)
}

export function drawGlyphFrame(
  ctx: CanvasRenderingContext2D,
  timeline: GlyphTimeline,
  scene: Scene,
  frame: number
): number {
  const phase = frame / timeline.totalFrames
  const breath = smooth01(phase / BREATH) * smooth01((1 - phase) / BREATH)
  if (breath <= 0.003) return 0

  // stage [-1,1] maps to half the safe area's short side around its center;
  // the timeline stretches slot x/y for the frame aspect (stageAspect)
  const safe = safeArea(timeline.width, timeline.height, timeline.title !== undefined)
  const stagePx = Math.min(safe.w, safe.h) * 0.5
  const cx = safe.x + safe.w / 2
  const cy = safe.y + safe.h / 2
  const ink = timeline.palette.silk
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  let drawn = 0
  for (const track of timeline.tracks) {
    const glyph = scene.glyphs.get(track.glyphId)
    if (glyph === undefined) continue
    for (const atom of sampleTrack(track, phase)) {
      const alpha = atom.alpha * breath
      if (alpha <= 0.004) continue
      ctx.globalAlpha = alpha
      drawAtom(ctx, glyph, atom, cx, cy, stagePx)
      drawn += 1
    }
  }
  ctx.globalAlpha = 1
  drawTitle(ctx, timeline, phase, breath)
  return drawn
}
