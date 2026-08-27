import { describe, expect, it } from 'vitest'
import { compileTimeline } from './index.js'
import { sampleDirectedKeyframes } from './sample-directed.js'
import type { FilmConfig, FilmShot, UnitTrack } from './index.js'
import { boardModel } from '../test/helpers.js'
import { makeSyntheticBoard } from '../test/synthetic.js'
import { defaultConfig } from './grammar.test.js'

const ecc83 = () => boardModel('ecc83-pp.kicad_pcb')

function shotOf(timeline: ReturnType<typeof compileTimeline>, id: FilmShot['id']): FilmShot {
  const shot = timeline.shots.find((candidate) => candidate.id === id)
  if (!shot) throw new Error(`missing directed shot ${id}`)
  return shot
}

function firstRisingTrack(timeline: ReturnType<typeof compileTimeline>): UnitTrack {
  for (const shot of timeline.shots) {
    for (const track of shot.tracks) {
      const first = track.keyframes[0]
      const second = track.keyframes[1]
      if (first && second && second.opacity > first.opacity && second.frame - first.frame >= 3) return track
    }
  }
  throw new Error('directed timeline has no rising track')
}

describe('directed symmetry topology', () => {
  it('maps symmetry modes to copy topology on the bilateral shot', () => {
    const board = ecc83()
    const topologyFor = (symmetry: NonNullable<FilmConfig['knobs']['symmetry']>) => {
      const timeline = compileTimeline(board, defaultConfig({ knobs: { symmetry } }))
      return shotOf(timeline, 'bilateral-tower').tracks.map((track) => track.copies)
    }

    expect(topologyFor('none').every((topology) => topology.mode === 'none' && topology.transforms.length === 1)).toBe(true)
    expect(topologyFor('mirror-x').some((topology) => topology.mode === 'mirror-x' && topology.transforms.length === 2)).toBe(true)
    expect(topologyFor('mirror-y').some((topology) => topology.mode === 'mirror-y' && topology.transforms.length === 2)).toBe(true)
    expect(topologyFor('rotational180').some((topology) => topology.mode === 'rotational180' && topology.transforms.length === 2)).toBe(true)
    expect(topologyFor('quad').some((topology) => topology.mode === 'quad' && topology.transforms.length === 4)).toBe(true)
  })
})

describe('directed rhythm and beats', () => {
  it('rhythmDensity changes the vertical seed stagger schedule', () => {
    const board = ecc83()
    const low = shotOf(compileTimeline(board, defaultConfig({ knobs: { rhythmDensity: 0 } })), 'vertical-seed')
    const high = shotOf(compileTimeline(board, defaultConfig({ knobs: { rhythmDensity: 1 } })), 'vertical-seed')
    const firstFrames = (shot: FilmShot) => shot.tracks.map((track) => track.keyframes[0]?.frame)
    expect(firstFrames(low)).not.toEqual(firstFrames(high))
    expect(Math.max(...firstFrames(high).map((frame) => frame ?? 0))).toBeGreaterThan(Math.max(...firstFrames(low).map((frame) => frame ?? 0)))
  })

  it('beatCount and beatIntensity are represented by directed beat metadata', () => {
    const zero = compileTimeline(ecc83(), defaultConfig({ knobs: { beatCount: 0 } }))
    const one = compileTimeline(ecc83(), defaultConfig({ knobs: { beatCount: 1, beatIntensity: 0.15 } }))
    const many = compileTimeline(ecc83(), defaultConfig({ knobs: { beatCount: 5, beatIntensity: 0.9 } }))
    expect(zero.directedBeats).toEqual([])
    expect(one.directedBeats).toEqual([{ frame: shotOf(one, 'radial-gate').startFrame, intensity: 0.15 }])
    expect(many.directedBeats).toEqual([
      { frame: shotOf(many, 'radial-gate').startFrame, intensity: 0.9 },
      { frame: shotOf(many, 'bilateral-tower').startFrame, intensity: 0.9 },
      { frame: shotOf(many, 'horizontal-study').startFrame, intensity: 0.9 }
    ])
  })
})

describe('directed interpolation and render parameters', () => {
  it('easing changes sampled opacity on a directed track', () => {
    const linear = compileTimeline(makeSyntheticBoard(120), defaultConfig({ knobs: { easing: 'linear' } }))
    const expo = compileTimeline(makeSyntheticBoard(120), defaultConfig({ knobs: { easing: 'expo-out' } }))
    const linearTrack = firstRisingTrack(linear)
    const expoTrack = firstRisingTrack(expo)
    const first = linearTrack.keyframes[0]
    const second = linearTrack.keyframes[1]
    expect(first && second).toBeTruthy()
    if (!first || !second) return
    const frame = Math.floor((first.frame + second.frame) / 2)
    const linearOpacity = sampleDirectedKeyframes(linearTrack, frame, 'linear')?.opacity ?? 0
    const expoOpacity = sampleDirectedKeyframes(expoTrack, frame, 'expo-out')?.opacity ?? 0
    expect(Math.abs(expoOpacity - second.opacity)).toBeLessThan(Math.abs(linearOpacity - second.opacity))
  })

  it('carries palette, render knobs, and symmetry into the directed timeline', () => {
    const timeline = compileTimeline(ecc83(), defaultConfig({
      knobs: {
        symmetry: 'rotational180',
        glow: 0.8,
        flicker: 0.5,
        grain: 0.4,
        exposure: 1.5,
        palette: 'amber',
        easing: 'back-out'
      }
    }))
    expect(timeline.palette.name).toBe('amber')
    expect(timeline.palette.stroke).toEqual({ r: 255, g: 176, b: 59 })
    expect(timeline.renderParams).toEqual({
      glow: 0.8,
      flicker: 0.5,
      grain: 0.4,
      exposure: 1.5,
      easing: 'back-out',
      symmetry: 'rotational180'
    })
  })

  it('dissolveStyle changes the directed exit schedule', () => {
    const board = ecc83()
    const styles = (['center-out', 'fade', 'wipe', 'scatter'] as const).map((dissolveStyle) =>
      JSON.stringify(compileTimeline(board, defaultConfig({ knobs: { dissolveStyle } })).shots)
    )
    expect(new Set(styles).size).toBe(4)
  })
})
