import React from 'react'
import { AbsoluteFill, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import { drawFrame, buildScene, postOptionsFor } from './film'
import type { Scene } from './film'
import { createPost } from './post'
import type { Post } from './post'
import { createTraceGL } from './trace-gl'
import type { TraceGL } from './trace-gl'
import { drawTitle } from './title'
import { useFont } from './font'

export interface FilmProps {
  timeline: Timeline
  grain?: boolean
  children?: React.ReactNode
}

/** motion-blur subframes: full shutter for renders, one sample for live preview */
const SUBFRAMES = 5

export const FilmCanvas: React.FC<FilmProps> = ({ timeline, grain = true, children }) => {
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

  // pick the pipeline once per mounted canvas: the lit trace renderer, else
  // the flat 2d draw through the webgl2 post pass, else plain 2d
  React.useLayoutEffect(() => {
    postRef.current = createPost() ?? null
    if (timeline.style === 'trace') {
      const sub = getRemotionEnvironment().isRendering ? SUBFRAMES : 1
      traceRef.current = createTraceGL(timeline.width, timeline.height, sub) ?? null
    }
    readyRef.current = true
    return () => {
      postRef.current?.dispose()
      postRef.current = null
      traceRef.current?.dispose()
      traceRef.current = null
      readyRef.current = false
    }
  }, [timeline.style, timeline.width, timeline.height])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !readyRef.current) return
    const target = canvas.getContext('2d')
    if (!target) return
    if (timeline.style === 'trace' && traceRef.current !== null) {
      const out = traceRef.current.render(timeline, frame)
      target.clearRect(0, 0, canvas.width, canvas.height)
      target.drawImage(out, 0, 0)
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
