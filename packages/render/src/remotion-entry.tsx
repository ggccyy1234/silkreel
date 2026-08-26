import React from 'react'
import { Composition, registerRoot, getInputProps } from 'remotion'
import type { Timeline } from '@silk-reel/choreo'
import type { BoardModel } from '@silk-reel/ingest'
import { Film } from './FilmComponent'

export interface FilmInputProps {
  timeline: Timeline
  board: BoardModel
}

function readInputProps(): FilmInputProps {
  const props = getInputProps() as Partial<FilmInputProps>
  if (!props || typeof props !== 'object' || !props.timeline || !props.board) {
    throw new Error('remotion-entry requires inputProps { timeline, board }')
  }
  return { timeline: props.timeline, board: props.board }
}

const EntryFilm: React.FC = () => {
  const { timeline, board } = readInputProps()
  return <Film timeline={timeline} board={board} />
}

const Root: React.FC = () => {
  const { timeline } = readInputProps()
  return (
    <Composition
      id="film"
      component={EntryFilm}
      durationInFrames={timeline.totalFrames}
      fps={timeline.fps}
      width={timeline.width}
      height={timeline.height}
    />
  )
}

registerRoot(Root)
