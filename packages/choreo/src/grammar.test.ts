import { describe, expect, it } from 'vitest'
import { compileTimeline, defaultActOrder } from './index.js'
import type { FilmConfig, ShotId, Timeline } from './index.js'
import { boardModel } from '../test/helpers.js'
import { makeSyntheticBoard } from '../test/synthetic.js'

const SHOT_IDS: readonly ShotId[] = [
  'black-breath',
  'vertical-seed',
  'cross-collapse',
  'radial-gate',
  'bilateral-tower',
  'corner-bridge',
  'horizontal-study',
  'pad-coda',
  'black-cut'
]

const ecc83 = () => boardModel('ecc83-pp.kicad_pcb')
const stickhub = () => boardModel('StickHub.kicad_pcb')

function assertDirectedTimeline(timeline: Timeline): void {
  expect(timeline.fps).toBeGreaterThan(0)
  expect(timeline.totalFrames).toBe(Math.round(timeline.durationSeconds * timeline.fps))
  expect(timeline.output).toEqual({ width: timeline.width, height: timeline.height, fps: timeline.fps })
  expect(timeline.shots.map((shot) => shot.id)).toEqual(SHOT_IDS)
  expect(timeline.shots[0]?.startFrame).toBe(0)
  expect(timeline.shots.at(-1)?.endFrame).toBe(timeline.totalFrames - 1)

  const castIds = new Set(timeline.cast.map((unit) => unit.id))
  expect(castIds.size).toBe(timeline.cast.length)
  for (const unit of timeline.cast) {
    expect(unit.memberRefs.length).toBeGreaterThan(0)
    expect(Object.values(unit.bounds.min).every(Number.isFinite)).toBe(true)
    expect(Object.values(unit.bounds.max).every(Number.isFinite)).toBe(true)
  }

  let previousEnd = -1
  for (const shot of timeline.shots) {
    expect(shot.startFrame).toBe(previousEnd + 1)
    expect(shot.endFrame).toBeGreaterThanOrEqual(shot.startFrame)
    expect(shot.endFrame).toBeLessThan(timeline.totalFrames)
    previousEnd = shot.endFrame
    const trackIds = new Set<string>()
    for (const track of shot.tracks) {
      expect(castIds.has(track.castId)).toBe(true)
      expect(trackIds.has(track.castId)).toBe(false)
      trackIds.add(track.castId)
      expect(track.copies.transforms.length).toBeGreaterThan(0)
      expect(track.keyframes.length).toBeGreaterThanOrEqual(2)
      let previousFrame = shot.startFrame - 1
      for (const keyframe of track.keyframes) {
        expect(keyframe.frame).toBeGreaterThanOrEqual(shot.startFrame)
        expect(keyframe.frame).toBeLessThanOrEqual(shot.endFrame)
        expect(keyframe.frame).toBeGreaterThanOrEqual(previousFrame)
        expect([keyframe.x, keyframe.y, keyframe.scale, keyframe.rotation, keyframe.opacity, keyframe.glow].every(Number.isFinite)).toBe(true)
        previousFrame = keyframe.frame
      }
    }
  }
  expect(previousEnd).toBe(timeline.totalFrames - 1)
  expect(timeline.directedBeats.every((beat) => beat.frame >= 0 && beat.frame < timeline.totalFrames)).toBe(true)
  expect(Object.prototype.hasOwnProperty.call(timeline, 'acts')).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(timeline, 'elements')).toBe(false)
  expect(Object.prototype.hasOwnProperty.call(timeline, 'beats')).toBe(false)
}

describe('directed timeline grammar', () => {
  it('compiles the canonical reference grammar at 167 frames', () => {
    const timeline = compileTimeline(ecc83(), defaultConfig({ duration: 167 / 15 }))
    assertDirectedTimeline(timeline)
    expect(timeline.shots.map((shot) => [shot.id, shot.startFrame, shot.endFrame])).toEqual([
      ['black-breath', 0, 4],
      ['vertical-seed', 5, 34],
      ['cross-collapse', 35, 54],
      ['radial-gate', 55, 69],
      ['bilateral-tower', 70, 104],
      ['corner-bridge', 105, 119],
      ['horizontal-study', 120, 154],
      ['pad-coda', 155, 165],
      ['black-cut', 166, 166]
    ])
    expect(timeline.shots[0]?.tracks).toEqual([])
    expect(timeline.shots.at(-1)?.tracks).toEqual([])
    expect(timeline.shots.find((shot) => shot.id === 'pad-coda')?.tracks).toHaveLength(4)
  })

  it('holds across symmetry modes and dissolve styles', () => {
    for (const symmetry of ['auto', 'mirror-x', 'mirror-y', 'quad', 'rotational180', 'none'] as const) {
      assertDirectedTimeline(compileTimeline(stickhub(), defaultConfig({ knobs: { symmetry } })))
    }
    for (const dissolveStyle of ['center-out', 'fade', 'wipe', 'scatter'] as const) {
      assertDirectedTimeline(compileTimeline(stickhub(), defaultConfig({ knobs: { dissolveStyle } })))
    }
  })
})

describe('directed cast boundary', () => {
  it('keeps assembly membership atomic while allowing a sparse cast', () => {
    const board = ecc83()
    const timeline = compileTimeline(board, defaultConfig())
    const castById = new Map(timeline.cast.map((unit) => [unit.id, unit]))
    const sourceIds = new Set<string>()
    for (const copper of Object.values(board.copper)) {
      for (const trace of copper.traces) sourceIds.add(trace.id)
      for (const pad of copper.pads) sourceIds.add(pad.id)
      for (const via of copper.vias) sourceIds.add(via.id)
      for (const zone of copper.zones) sourceIds.add(zone.id)
    }
    for (const silk of Object.values(board.silkscreen)) {
      for (const line of silk.lines) sourceIds.add(line.id)
      for (const arc of silk.arcs) sourceIds.add(arc.id)
      for (const text of silk.texts) sourceIds.add(text.id)
    }
    for (const outline of board.outline) sourceIds.add(outline.id)
    for (const drill of board.drill) sourceIds.add(drill.id)

    for (const unit of timeline.cast) {
      expect(unit.memberRefs.every((ref) => sourceIds.has(ref))).toBe(true)
      if (unit.role !== 'hero-body' && unit.role !== 'detail') continue
      const ref = unit.id.slice(unit.id.indexOf(':') + 1)
      const footprint = board.footprints.find((candidate) => candidate.ref === ref)
      expect(footprint).toBeDefined()
      expect(new Set(unit.memberRefs)).toEqual(new Set([...(footprint?.padRefs ?? []), ...(footprint?.silkRefs ?? [])]))
    }
    for (const shot of timeline.shots) {
      for (const track of shot.tracks) expect(castById.has(track.castId)).toBe(true)
    }
  })
})

describe('directed duration and ordering', () => {
  it('preserves duration policy without act output', () => {
    const small = compileTimeline(makeSyntheticBoard(30), defaultConfig())
    expect(small.durationSeconds).toBeGreaterThanOrEqual(7)
    expect(small.durationSeconds).toBeLessThanOrEqual(9)

    const mid = compileTimeline(makeSyntheticBoard(300), defaultConfig())
    expect(mid.durationSeconds).toBeGreaterThanOrEqual(10)
    expect(mid.durationSeconds).toBeLessThanOrEqual(12)

    const video = compileTimeline(boardModel('video.kicad_pcb'), defaultConfig())
    expect(video.durationSeconds).toBeLessThanOrEqual(20)
    expect(compileTimeline(makeSyntheticBoard(4), defaultConfig()).durationSeconds).toBeGreaterThanOrEqual(6)
    const explicit = compileTimeline(makeSyntheticBoard(30), defaultConfig({ duration: 14 }))
    expect(Math.abs(explicit.durationSeconds - 14)).toBeLessThanOrEqual(0.5 / explicit.fps + 1e-9)
  })

  it('warns about unknown actOrder entries while retaining FilmConfig ordering input', () => {
    const board = stickhub()
    const known = defaultActOrder(board)
    const timeline = compileTimeline(board, defaultConfig({ actOrder: [...known, 'silk:missing'] }))
    expect(timeline.warnings.some((warning) => warning.code === 'act-order-ignored')).toBe(true)
    expect(timeline.cast.every((unit) => known.includes(unit.sourceAct))).toBe(true)
    assertDirectedTimeline(timeline)
  })

  it('places directed beats inside the shot grammar', () => {
    const timeline = compileTimeline(ecc83(), defaultConfig({ knobs: { beatCount: 3 } }))
    expect(timeline.directedBeats.map((beat) => beat.frame)).toEqual([
      timeline.shots.find((shot) => shot.id === 'radial-gate')?.startFrame,
      timeline.shots.find((shot) => shot.id === 'bilateral-tower')?.startFrame,
      timeline.shots.find((shot) => shot.id === 'horizontal-study')?.startFrame
    ])
    for (const beat of timeline.directedBeats) {
      expect(timeline.shots.some((shot) => beat.frame >= shot.startFrame && beat.frame <= shot.endFrame)).toBe(true)
    }
  })
})

export function defaultConfig(overrides: Partial<FilmConfig> = {}): FilmConfig {
  return {
    actOrder: [],
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 15 },
    ...overrides
  }
}
