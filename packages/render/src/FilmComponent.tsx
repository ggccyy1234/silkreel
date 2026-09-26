import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import { drawFrame, buildScene } from './film'
import type { Scene } from './film'
import { createPost } from './post'
import type { Post } from './post'
import { useFont } from './font'

export interface FilmProps {
  timeline: Timeline
  grain?: boolean
  children?: React.ReactNode
}

export const FilmCanvas: React.FC<FilmProps> = ({ timeline, grain = true, children }) => {
  useFont()
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const postRef = React.useRef<Post | null>(null)
  const readyRef = React.useRef(false)

  const scene = React.useMemo<Scene>(() => buildScene(timeline), [timeline])
  const offscreen = React.useMemo(() => {
    const c = document.createElement('canvas')
    c.width = timeline.width
    c.height = timeline.height
    return c
  }, [timeline])

  // pick the pipeline once per mounted canvas: webgl2 post, else plain 2d
  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    postRef.current = createPost(canvas) ?? null
    readyRef.current = true
    return () => {
      postRef.current?.dispose()
      postRef.current = null
      readyRef.current = false
    }
  }, [])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !readyRef.current) return
    const ctx = offscreen.getContext('2d')
    if (!ctx) return
    drawFrame(ctx, timeline, scene, frame)
    const post = postRef.current
    if (post !== null) {
      post.render(offscreen, {
        bloom: timeline.palette.bloom,
        grain: grain && !timeline.transparent,
        vignette: !timeline.transparent,
        transparent: timeline.transparent,
        frame
      })
    } else {
      const target = canvas.getContext('2d')
      if (!target) return
      target.clearRect(0, 0, canvas.width, canvas.height)
      target.drawImage(offscreen, 0, 0)
    }
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
