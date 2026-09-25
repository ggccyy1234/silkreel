import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import { drawTimelineFrame, buildScene } from './film'
import type { Scene } from './film'

export interface FilmProps {
  timeline: Timeline
  children?: React.ReactNode
}

export const FilmCanvas: React.FC<FilmProps> = ({ timeline, children }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  const scene = React.useMemo<Scene>(() => buildScene(timeline), [timeline])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawTimelineFrame(ctx, { timeline, scene }, frame)
  }, [frame, timeline, scene])

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: '#000000' } },
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
