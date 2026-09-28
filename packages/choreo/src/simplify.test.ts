import { describe, expect, it } from 'vitest'
import { simplifyStrokes } from './simplify'
import type { Vec2 } from '@silk-reel/ingest'

/** distance from p to segment ab */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** distance from p to a polyline */
function polyDist(p: Vec2, s: Vec2[]): number {
  let best = Infinity
  for (let i = 1; i < s.length; i++) {
    best = Math.min(best, segDist(p, s[i - 1] as Vec2, s[i] as Vec2))
  }
  return best
}

describe('simplifyStrokes', () => {
  it('keeps the output within epsilon of the input polyline', () => {
    // a shallow wave: amplitude just under the 0.008·span epsilon
    const span = 10
    const input: Vec2[] = []
    for (let i = 0; i <= 40; i++) {
      input.push({ x: (i / 40) * span, y: Math.sin(i * 0.5) * 0.05 })
    }
    const out = simplifyStrokes([input], span)
    expect(out.length).toBe(1)
    const s = out[0] as Vec2[]
    expect(s.length).toBeLessThan(input.length)
    // every input point stays within ε of the simplified polyline
    for (const p of input) {
      expect(polyDist(p, s)).toBeLessThanOrEqual(0.008 * span + 1e-9)
    }
  })

  it('merges runs of collinear points', () => {
    const line: Vec2[] = []
    for (let i = 0; i <= 10; i++) line.push({ x: i, y: i * 2 })
    const out = simplifyStrokes([line], 30)
    expect(out).toEqual([[line[0], line[10]]])
  })

  it('drops strokes shorter than 0.03·span', () => {
    const span = 10
    const tiny: Vec2[] = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }] // 0.2 < 0.3
    const long: Vec2[] = [{ x: 0, y: 5 }, { x: 4, y: 5 }]
    const out = simplifyStrokes([tiny, long], span)
    expect(out.length).toBe(1)
    expect(out[0]).toEqual(long)
  })

  it('joins strokes whose endpoints touch into one polyline', () => {
    // a rectangle authored as four separate edges
    const span = 10
    const edges: Vec2[][] = [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 10, y: 0 }, { x: 10, y: 5 }],
      [{ x: 10, y: 5 }, { x: 0, y: 5 }],
      [{ x: 0, y: 5 }, { x: 0, y: 0 }]
    ]
    const out = simplifyStrokes(edges, span)
    expect(out.length).toBe(1)
    const ring = out[0] as Vec2[]
    expect(ring.length).toBe(5)
    // closed: the last point is the first
    expect(ring[0]).toEqual(ring[4])
  })

  it('keeps a chamfered corner instead of collapsing it', () => {
    const span = 10
    const chamfered: Vec2[] = [
      { x: 1, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: 1 },
      { x: 1, y: 0 }
    ]
    const out = simplifyStrokes([chamfered], span)
    expect(out.length).toBe(1)
    expect((out[0] as Vec2[]).length).toBe(6)
  })
})
