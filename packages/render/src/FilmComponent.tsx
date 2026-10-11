import React from 'react'
import { AbsoluteFill, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import { drawFrame, buildScene, postOptionsFor } from './film'
import type { Scene } from './film'
import { createPost } from './post'
import type { Post } from './post'
import { createTraceGL } from './trace-gl'
import type { Annotation, TraceGL, TraceQuality } from './trace-gl'
import { drawTitle } from './title'
import { FONT, useFont } from './font'

export type RenderQuality = 'draft' | 'final'

export interface FilmProps {
  timeline: Timeline
  grain?: boolean
  /** final: full motion blur and map resolution; draft: one sample, lighter maps (studio preview, quick renders) */
  quality?: RenderQuality
  children?: React.ReactNode
}

const QUALITY: Record<RenderQuality, TraceQuality> = {
  final: { subframes: 5, mapScale: 1.6 },
  draft: { subframes: 1, mapScale: 1.25 }
}

/** thin leader lines and small caps: captions that sit on the film, not over it */
export function drawAnnotations(ctx: CanvasRenderingContext2D, anns: Annotation[], W: number, H: number): void {
  const u = Math.min(W, H) / 1080
  for (const a of anns) {
    ctx.save()
    ctx.globalAlpha = a.alpha
    ctx.strokeStyle = 'rgba(236,240,244,0.75)'
    ctx.fillStyle = 'rgba(236,240,244,0.95)'
    ctx.lineWidth = Math.max(1, 1.2 * u)
    ctx.beginPath()
    ctx.arc(a.ax, a.ay, 3 * u, 0, Math.PI * 2)
    ctx.stroke()
    const dir = a.align === 'left' ? 1 : -1
    ctx.beginPath()
    ctx.moveTo(a.ax + dir * 3 * u, a.ay)
    ctx.lineTo(a.lx, a.ly)
    ctx.lineTo(a.lx + dir * 26 * u, a.ly)
    ctx.stroke()
    ctx.textAlign = a.align
    ctx.textBaseline = 'alphabetic'
    const x = a.lx + dir * 32 * u
    ctx.font = `600 ${Math.round(19 * u)}px ${FONT}`
    ctx.fillText(a.text.toUpperCase(), x, a.ly + 6 * u)
    if (a.sub !== undefined) {
      ctx.globalAlpha = a.alpha * 0.6
      ctx.font = `${Math.round(14 * u)}px ${FONT}`
      ctx.fillText(a.sub, x, a.ly + 26 * u)
    }
    ctx.restore()
  }
}

export const FilmCanvas: React.FC<FilmProps> = ({ timeline, grain = true, quality, children }) => {
  useFont()
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const postRef = React.useRef<Post | null>(null)
  const traceRef = React.useRef<TraceGL | null>(null)
  const readyRef = React.useRef(false)

  const scene = React.useMemo<Scene>(() => buildScene(timeline), [timeline])
  const offscreen = React.useMemo(() => {
    const c = document.createElement('canvas')
    c.width = timeline.width
    c.height = timeline.height
    return c
  }, [timeline])
  // the live preview is always draft; renders default to final
  const level: RenderQuality = getRemotionEnvironment().isRendering ? (quality ?? 'final') : 'draft'

  // pick the pipeline once per mounted canvas: the lit trace renderer, else
  // the flat 2d draw through the webgl2 post pass, else plain 2d
  React.useLayoutEffect(() => {
    postRef.current = createPost() ?? null
    if (timeline.style === 'trace') traceRef.current = createTraceGL(timeline.width, timeline.height, QUALITY[level]) ?? null
    readyRef.current = true
    return () => {
      postRef.current?.dispose()
      postRef.current = null
      traceRef.current?.dispose()
      traceRef.current = null
      readyRef.current = false
    }
  }, [timeline.style, timeline.width, timeline.height, level])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !readyRef.current) return
    const target = canvas.getContext('2d')
    if (!target) return
    if (timeline.style === 'trace' && traceRef.current !== null) {
      const out = traceRef.current.render(timeline, frame)
      target.clearRect(0, 0, canvas.width, canvas.height)
      target.drawImage(out, 0, 0)
      drawAnnotations(target, traceRef.current.annotations(), canvas.width, canvas.height)
      const p = frame / timeline.totalFrames
      const fade = 1 - Math.min(1, Math.max(0, (p - timeline.scene.beats.fade[0]) / (timeline.scene.beats.fade[1] - timeline.scene.beats.fade[0])))
      drawTitle(target, timeline, p, fade)
      return
    }
    const ctx = offscreen.getContext('2d')
    if (!ctx) return
    drawFrame(ctx, timeline, scene, frame)
    const out = postRef.current?.render(offscreen, { ...postOptionsFor(timeline, grain), frame }) ?? offscreen
    target.clearRect(0, 0, canvas.width, canvas.height)
    target.drawImage(out, 0, 0)
  }, [frame, timeline, scene, offscreen, grain])

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: timeline.transparent ? 'transparent' : timeline.palette.bg } },
    React.createElement('canvas', {
      ref: canvasRef,
      width,
      height,
      style: { width, height, display: 'block' }
    }),
    children
  )
}

export const Film: React.FC<FilmProps> = (props) => <FilmCanvas {...props} />
