import React from 'react'
import { Composition, registerRoot, getInputProps } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import { Film } from './FilmComponent'
import type { RenderQuality } from './FilmComponent'

export interface FilmInputProps {
  timeline: Timeline
  /** film grain in the post pass (off for GIF: per-frame noise defeats palette compression) */
  grain?: boolean
  /** trace render quality: 'final' (default) or 'draft' */
  quality?: RenderQuality
}

function readInputProps(source: unknown): FilmInputProps {
  const props = source as Partial<FilmInputProps> | undefined
  if (!props?.timeline) {
    throw new Error('remotion-entry requires inputProps { timeline }')
  }
  return {
    timeline: props.timeline,
    ...(props.grain !== undefined ? { grain: props.grain } : {}),
    ...(props.quality !== undefined ? { quality: props.quality } : {})
  }
}

const EntryFilm: React.FC<Record<string, unknown>> = (props) => {
  const { timeline, grain, quality } = readInputProps(props)
  return <Film timeline={timeline} grain={grain ?? true} {...(quality !== undefined ? { quality } : {})} />
}

const Root: React.FC = () => {
  const defaultProps = readInputProps(getInputProps())
  return (
    <Composition
      id="film"
      component={EntryFilm}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const { timeline } = readInputProps(props)
        return {
          durationInFrames: timeline.totalFrames,
          fps: timeline.fps,
          width: timeline.width,
          height: timeline.height
        }
      }}
    />
  )
}

registerRoot(Root)
