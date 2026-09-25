import { describe, expect, it } from 'vitest'
import { growthSchedule } from './graph'
import type { GraphSeg, GraphLink } from './graph'

const seg = (layer: string, ax: number, ay: number, bx: number, by: number): GraphSeg =>
  ({ layer, a: { x: ax, y: ay }, b: { x: bx, y: by }, width: 0.25 })

describe('growthSchedule', () => {
  it('grows outward from the seed along a chain and orients each segment', () => {
    const segs = [seg('F.Cu', 2, 0, 1, 0), seg('F.Cu', 0, 0, 1, 0), seg('F.Cu', 2, 0, 3, 0)]
    const r = growthSchedule(segs, [], [{ layer: 'F.Cu', pos: { x: 0, y: 0 } }], { x: 0, y: 0 })
    expect(r.start).toEqual([1, 0, 2])        // segment 0 starts at dist 1, seg1 at 0, seg2 at 2
    expect(r.flipped[0]).toBe(true)           // seg0 was authored b→a relative to growth
    expect(r.flipped[1]).toBe(false)
  })
  it('crosses layers through a via link', () => {
    const segs = [seg('F.Cu', 0, 0, 1, 0), seg('B.Cu', 1, 0, 1, 5)]
    const links: GraphLink[] = [{ pos: { x: 1, y: 0 }, r: 0.3 }]
    const r = growthSchedule(segs, links, [{ layer: 'F.Cu', pos: { x: 0, y: 0 } }], { x: 0, y: 0 })
    expect(r.start[1]).toBeCloseTo(1, 5)
    expect(r.linkTime[0]).toBeCloseTo(1, 5)
  })
  it('gives unreachable islands a start time from their distance to the origin', () => {
    const segs = [seg('F.Cu', 0, 0, 1, 0), seg('F.Cu', 10, 0, 11, 0)]
    const r = growthSchedule(segs, [], [{ layer: 'F.Cu', pos: { x: 0, y: 0 } }], { x: 0, y: 0 })
    expect(r.start[1]).toBeCloseTo(10, 5)
    expect(r.flipped[1]).toBe(false)
  })
})
