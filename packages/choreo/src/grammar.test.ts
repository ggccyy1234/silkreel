import { describe, expect, it } from 'vitest'
import type { Timeline } from './index.js'
import { compileTimeline } from './index.js'
import { boardModel, makeSyntheticBoard } from './helpers.js'

const ecc83 = () => boardModel('ecc83-pp.kicad_pcb')
const stickhub = () => boardModel('StickHub.kicad_pcb')

const PHASE_ORDER = ['seed', 'populate', 'beat', 'build', 'sustain', 'dissolve'] as const

function expectedOrder(phases: { kind: string }[]): void {
  const ranks = phases.map((p) => {
    const rank = PHASE_ORDER.indexOf(p.kind as (typeof PHASE_ORDER)[number])
    expect(rank, `unknown phase kind ${p.kind}`).toBeGreaterThanOrEqual(0)
    return rank
  })
  for (let i = 1; i < ranks.length; i++) {
    expect(ranks[i] as number, `phase ${phases[i]?.kind} out of order after ${phases[i - 1]?.kind}`).toBeGreaterThan(
      ranks[i - 1] as number
    )
  }
}

function assertTimelineStructure(tl: Timeline): void {
  expect(tl.fps).toBeGreaterThan(0)
  expect(tl.totalFrames).toBe(Math.round((tl.durationSeconds * tl.fps)))
  expect(tl.width).toBe(1080)
  expect(tl.height).toBe(1350)
  expect(tl.acts.length).toBeGreaterThanOrEqual(2)
  expect(tl.acts[0]?.startFrame).toBe(0)
  const last = tl.acts[tl.acts.length - 1]
  expect(last?.endFrame).toBe(tl.totalFrames - 1)
  for (let i = 0; i < tl.acts.length; i++) {
    const act = tl.acts[i]
    if (act === undefined) throw new Error(`act ${i} missing`)
    expect(act.endFrame, `act ${act.id} end before start`).toBeGreaterThanOrEqual(act.startFrame)
    if (i > 0) {
      const prev = tl.acts[i - 1]
      expect(prev).toBeDefined()
      expect(act.startFrame, `act ${act.id} overlaps previous act`).toBeGreaterThan(prev?.endFrame ?? -2)
      expect(act.startFrame, `act ${act.id} leaves a gap after previous act`).toBeLessThanOrEqual((prev?.endFrame ?? -2) + 1)
    }
    expect(act.phases.length).toBeGreaterThanOrEqual(5)
    const kinds = act.phases.map((p) => p.kind)
    expect(kinds.filter((k) => k === 'seed').length, `act ${act.id} needs exactly one seed`).toBe(1)
    expect(kinds.filter((k) => k === 'populate').length).toBe(1)
    expect(kinds.filter((k) => k === 'build').length).toBe(1)
    expect(kinds.filter((k) => k === 'sustain').length).toBe(1)
    expect(kinds.filter((k) => k === 'dissolve').length).toBe(1)
    expect(kinds.filter((k) => k === 'beat').length).toBeLessThanOrEqual(1)
    expectedOrder(act.phases)
    let cursor = act.startFrame
    for (const phase of act.phases) {
      expect(phase.startFrame).toBe(cursor)
      expect(phase.endFrame).toBeGreaterThanOrEqual(phase.startFrame)
      cursor = phase.endFrame + 1
    }
    expect(cursor - 1, `act ${act.id} phases must tile the act exactly`).toBeGreaterThanOrEqual(act.endFrame - 1)
    expect(cursor, `act ${act.id} phases overshoot the act`).toBeLessThanOrEqual(act.endFrame + 2)
  }
  for (const beat of tl.beats) {
    expect(beat.frame).toBeGreaterThanOrEqual(0)
    expect(beat.frame).toBeLessThan(tl.totalFrames)
  }
}

describe('VAL-FILM-001 grammar phase structure', () => {
  it('every act follows seed→populate→[beat]→build→sustain→dissolve and acts tile [0,totalFrames)', () => {
    const tl = compileTimeline(ecc83(), defaultConfig())
    assertTimelineStructure(tl)
    console.log(
      tl.acts
        .map((a) => `${a.id} [${a.startFrame}-${a.endFrame}] ${a.phases.map((p) => p.kind).join('>')}`)
        .join('\n')
    )
  })

  it('structure holds across every symmetry mode and dissolve style', () => {
    for (const symmetry of ['auto', 'mirror-x', 'mirror-y', 'quad', 'rotational180', 'none'] as const) {
      const tl = compileTimeline(stickhub(), defaultConfig({ knobs: { symmetry } }))
      assertTimelineStructure(tl)
    }
    for (const dissolveStyle of ['center-out', 'fade', 'wipe', 'scatter'] as const) {
      const tl = compileTimeline(stickhub(), defaultConfig({ knobs: { dissolveStyle } }))
      assertTimelineStructure(tl)
    }
  })
})

describe('VAL-FILM-002 actOrder permutation', () => {
  it('silk-first reorder moves silk acts ahead of copper acts with identical act sets', () => {
    const base = defaultConfig({ seed: 42 })
    const a = compileTimeline(stickhub(), base)
    const silkFirst: Array<typeof a.acts[number]['id']> = [
      ...a.acts.filter((x) => x.unit.startsWith('silk')).map((x) => x.id),
      ...a.acts.filter((x) => !x.unit.startsWith('silk')).map((x) => x.id)
    ]
    const b = compileTimeline(stickhub(), defaultConfig({ seed: 42, actOrder: silkFirst }))
    const aIds = a.acts.map((x) => x.id).sort()
    const bIds = b.acts.map((x) => x.id).sort()
    expect(bIds).toEqual(aIds)
    expect(b.acts.map((x) => x.id)).toEqual(silkFirst)
    const lastSilkStartB = Math.max(...b.acts.filter((x) => x.unit.startsWith('silk')).map((x) => x.startFrame))
    const firstCopperStartB = Math.min(...b.acts.filter((x) => x.unit.startsWith('copper')).map((x) => x.startFrame))
    expect(lastSilkStartB).toBeLessThan(firstCopperStartB)
    const firstSilkStartA = Math.min(...a.acts.filter((x) => x.unit.startsWith('silk')).map((x) => x.startFrame))
    const lastCopperStartA = Math.max(...a.acts.filter((x) => x.unit.startsWith('copper')).map((x) => x.startFrame))
    expect(firstSilkStartA).toBeGreaterThan(lastCopperStartA)
    assertTimelineStructure(b)
  })
})

describe('VAL-FILM-003 exact element coverage', () => {
  function sourceElementIds(model: ReturnType<typeof boardModel>): string[] {
    const ids = new Set<string>()
    for (const o of model.outline) ids.add(o.id)
    for (const d of model.drill) ids.add(d.id)
    for (const c of Object.values(model.copper)) {
      for (const t of c.traces) ids.add(t.id)
      for (const p of c.pads) ids.add(p.id)
      for (const v of c.vias) ids.add(v.id)
      for (const z of c.zones) ids.add(z.id)
    }
    for (const s of Object.values(model.silkscreen)) {
      for (const l of s.lines) ids.add(l.id)
      for (const tx of s.texts) ids.add(tx.id)
    }
    return [...ids]
  }

  it('timeline elements are a bijection with distinct source elements', () => {
    const model = stickhub()
    const tl = compileTimeline(model, defaultConfig())
    const timelineIds = new Set(tl.elements.map((e) => e.id))
    expect(timelineIds.size).toBe(tl.elements.length)
    const sourceIds = new Set(sourceElementIds(model))
    const missing = [...sourceIds].filter((id) => !timelineIds.has(id))
    const extra = [...timelineIds].filter((id) => !sourceIds.has(id))
    expect(missing, 'source elements missing from timeline').toEqual([])
    expect(extra, 'timeline elements without source').toEqual([])
    for (const act of tl.acts) {
      const covered = tl.elements.filter((e) => e.actId === act.id)
      expect(covered.length, `act ${act.id} covers nothing`).toBeGreaterThan(0)
      expect(tl.acts.some((a) => a.id === act.id)).toBe(true)
    }
    for (const e of tl.elements) {
      expect(tl.acts.some((a) => a.id === e.actId), `element ${e.id} references unknown act ${e.actId}`).toBe(true)
    }
  })
})

describe('VAL-FILM-004 footprint atomicity', () => {
  it('all members of a footprint share identical appearance/disappearance frames', () => {
    const model = ecc83()
    const tl = compileTimeline(model, defaultConfig())
    const byId = new Map(tl.elements.map((e) => [e.id, e]))
    function firstVisible(elId: string): number | undefined {
      const el = byId.get(elId)
      if (!el) return undefined
      for (const k of el.keyframes) if (k.opacity > 0) return k.frame
      return undefined
    }
    function lastVisible(elId: string): number | undefined {
      const el = byId.get(elId)
      if (!el) return undefined
      for (let i = el.keyframes.length - 1; i >= 0; i--) {
        const k = el.keyframes[i]
        if (k && k.opacity > 0) return k.frame
      }
      return undefined
    }
    let checkedGroups = 0
    for (const fp of model.footprints) {
      const memberIds = [...fp.padRefs, ...fp.silkRefs].filter((id) => byId.has(id))
      expect(memberIds.length, `footprint ${fp.ref} refs unresolvable elements`).toBe(fp.padRefs.length + fp.silkRefs.length)
      if (memberIds.length < 2) continue
      const appears = memberIds.map(firstVisible)
      expect(appears.some((f) => f === undefined), `footprint ${fp.ref} has a never-visible member`).toBe(false)
      expect(new Set(appears).size, `footprint ${fp.ref} members appear at different frames`).toBe(1)
      const disappears = memberIds.map(lastVisible)
      expect(disappears.some((f) => f === undefined), `footprint ${fp.ref} has a member that never exits`).toBe(false)
      expect(new Set(disappears).size, `footprint ${fp.ref} members exit at different frames`).toBe(1)
      checkedGroups++
    }
    expect(checkedGroups).toBeGreaterThan(5)
  })
})

describe('VAL-FILM-005 duration policy', () => {
  it('synthetic boards land in their behavioral bands', () => {
    const small = compileTimeline(makeSyntheticBoard(30), defaultConfig())
    expect(small.durationSeconds).toBeGreaterThanOrEqual(7)
    expect(small.durationSeconds).toBeLessThanOrEqual(9)
    const mid = compileTimeline(makeSyntheticBoard(300), defaultConfig())
    expect(mid.durationSeconds).toBeGreaterThanOrEqual(10)
    expect(mid.durationSeconds).toBeLessThanOrEqual(12)
  })

  it('video board auto-duration respects the 20s cap and floor holds at 6s', () => {
    const video = compileTimeline(boardModel('video.kicad_pcb'), defaultConfig({ duration: 'auto' }))
    expect(video.durationSeconds).toBeLessThanOrEqual(20)
    const tiny = makeSyntheticBoard(4)
    const floor = compileTimeline(tiny, defaultConfig())
    expect(floor.durationSeconds).toBeGreaterThanOrEqual(6)
  })

  it('totalFrames equals round(duration × fps) on every compilation', () => {
    for (const count of [30, 300]) {
      const tl = compileTimeline(makeSyntheticBoard(count), defaultConfig())
      expect(tl.totalFrames).toBe(Math.round(tl.durationSeconds * tl.fps))
    }
  })

  it('numeric duration override wins exactly over policy', () => {
    const tl = compileTimeline(makeSyntheticBoard(30), defaultConfig({ duration: 14 }))
    expect(Math.abs(tl.durationSeconds - 14)).toBeLessThanOrEqual(0.5 / tl.fps + 1e-9)
    expect(tl.totalFrames).toBe(Math.round(14 * tl.fps))
  })
})

export function defaultConfig(overrides: Partial<Parameters<typeof compileTimeline>[1]> = {}): Parameters<typeof compileTimeline>[1] {
  return {
    actOrder: [],
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 15 },
    ...overrides
  }
}
