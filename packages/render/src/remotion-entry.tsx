import React from 'react'
import { Composition, registerRoot, getInputProps } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import type { BoardModel } from '@silk-reel/ingest'
import { Film } from './FilmComponent'

export interface FilmInputProps {
  timeline: Timeline
  board: BoardModel
}

function readInputProps(source: unknown): FilmInputProps {
  const props = source as Partial<FilmInputProps> | undefined
  if (!props?.timeline || !props.board) {
    throw new Error('remotion-entry requires inputProps { timeline, board }')
  }
  return { timeline: props.timeline, board: props.board }
}

const EntryFilm: React.FC<Record<string, unknown>> = (props) => {
  const { timeline, board } = readInputProps(props)
  return <Film timeline={timeline} board={board} />
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
