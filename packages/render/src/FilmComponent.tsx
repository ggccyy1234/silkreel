import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import { drawTimelineFrame, buildGeometryLookup, computeCastView } from './film'
import type { GeometryLookup } from './film'

export interface FilmProps {
  timeline: Timeline
  board: import('@silk-reel/ingest').BoardModel
  children?: React.ReactNode
}

export const FilmCanvas: React.FC<FilmProps> = ({ timeline, board, children }) => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  const geometry = React.useMemo<GeometryLookup>(() => buildGeometryLookup(board), [board])
  const view = React.useMemo(() => computeCastView(timeline, geometry), [geometry, timeline, width, height])

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawTimelineFrame(ctx, { timeline, geometry, view }, frame)
  }, [frame, timeline, geometry, view])

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: '#050505' } },
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
