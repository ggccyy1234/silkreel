import { describe, expect, it } from 'vitest'
import type { BoardModel, CopperLayers, SilkLayer } from '@silk-reel/ingest'
import { compileTimeline } from './compile'
import { boardModel } from '../test/helpers'
import { makeSyntheticBoard } from '../test/synthetic'

function config(seed: number | null = 42) {
  return {
    actOrder: [],
    knobs: { symmetry: 'quad' as const },
    seed,
    duration: 167 / 15,
    output: { width: 1080, height: 1350, fps: 15 }
  }
}

function completeMembers(board: BoardModel): Map<string, Set<string>> {
  return new Map(board.footprints.map((footprint) => [footprint.ref, new Set([...footprint.padRefs, ...footprint.silkRefs])]))
}

function withoutGeometry(board: BoardModel): BoardModel {
  const copper: Record<string, CopperLayers> = {}
  for (const [layer, source] of Object.entries(board.copper)) {
    copper[layer] = { traces: [], pads: source.pads.slice(0, 4), vias: [], zones: [] }
  }
  const silkscreen: Record<string, SilkLayer> = {}
  for (const layer of Object.keys(board.silkscreen)) silkscreen[layer] = { lines: [], arcs: [], texts: [] }
  return { ...board, copper, silkscreen, footprints: [], outline: [], drill: [] }
}

describe('semantic film director', () => {
  it('compiles the canonical reference grammar at 167 frames', () => {
    const timeline = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), config())
    expect(timeline.totalFrames).toBe(167)
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

  it('casts complete footprints and keeps pathological hatch fields out', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const timeline = compileTimeline(board, config())
    const membersByFootprint = completeMembers(board)
    const assemblyUnits = timeline.cast.filter((unit) => unit.role === 'hero-body' || unit.role === 'detail')
    expect(assemblyUnits.length).toBeGreaterThan(0)
    for (const unit of assemblyUnits) {
      const ref = unit.id.slice(unit.id.indexOf(':') + 1)
      expect(new Set(unit.memberRefs)).toEqual(membersByFootprint.get(ref))
    }
    expect(timeline.cast.some((unit) => unit.id.includes('C1'))).toBe(false)
    expect(timeline.cast.filter((unit) => unit.role === 'hero-body')).toHaveLength(2)
    expect(timeline.cast.filter((unit) => unit.role === 'trace-accent')).toHaveLength(5)
  })

  it('keeps every directed track tied to a cast unit and role window', () => {
    const timeline = compileTimeline(boardModel('ecc83-pp.kicad_pcb'), config())
    const castById = new Map(timeline.cast.map((unit) => [unit.id, unit]))
    for (const shot of timeline.shots) {
      for (const track of shot.tracks) {
        const unit = castById.get(track.castId)
        expect(unit).toBeDefined()
        expect(track.keyframes.every((keyframe) => keyframe.frame >= shot.startFrame && keyframe.frame <= shot.endFrame)).toBe(true)
        if (unit?.role === 'trace-accent' || unit?.role === 'text-accent') expect(['corner-bridge', 'horizontal-study']).toContain(shot.id)
        if (unit?.role === 'anchor-pad') expect(['corner-bridge', 'horizontal-study', 'pad-coda']).toContain(shot.id)
      }
    }
  })

  it('is deterministic for a seed and stays sparse for boards without assemblies', () => {
    const board = boardModel('kit-dev-coldfire-xilinx_5213.kicad_pcb')
    const first = compileTimeline(board, config())
    const second = compileTimeline(board, config())
    expect(JSON.stringify({ cast: first.cast, shots: first.shots })).toBe(JSON.stringify({ cast: second.cast, shots: second.shots }))

    const sparse = compileTimeline(makeSyntheticBoard(40), config())
    expect(sparse.cast.filter((unit) => unit.role === 'hero-body')).toHaveLength(0)
    expect(sparse.shots.filter((shot) => shot.tracks.length > 0).every((shot) => shot.id === 'horizontal-study')).toBe(true)
    expect(sparse.warnings.some((warning) => warning.code === 'cast-no-hero')).toBe(true)
  })

  it('reduces a pad-only board to anchors and never promotes a primitive', () => {
    const board = withoutGeometry(boardModel('ecc83-pp.kicad_pcb'))
    const timeline = compileTimeline(board, config())
    expect(timeline.cast.every((unit) => unit.role === 'anchor-pad')).toBe(true)
    expect(timeline.cast.length).toBeGreaterThan(0)
  })

  it('emits complete assemblies and keeps standalone traces out of hero units', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const traces = Object.values(board.copper).flatMap((layer) => layer.traces)
    const timeline = compileTimeline(board, config())
    const traceIds = new Set(traces.map((trace) => trace.id))
    for (const unit of timeline.cast.filter((candidate) => candidate.role === 'hero-body' || candidate.role === 'detail')) {
      const ref = unit.id.slice(unit.id.indexOf(':') + 1)
      const footprint = board.footprints.find((candidate) => candidate.ref === ref)
      expect(footprint).toBeDefined()
      expect(new Set(unit.memberRefs)).toEqual(new Set([...(footprint?.padRefs ?? []), ...(footprint?.silkRefs ?? [])]))
    }
    expect(timeline.cast.filter((unit) => unit.role === 'hero-body').some((unit) => unit.memberRefs.some((ref) => traceIds.has(ref)))).toBe(false)
  })
})
