import type { Vec2 } from '@silk-reel/ingest'

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Douglas–Peucker: keep the polyline within ε of the original */
function dp(points: Vec2[], eps: number): Vec2[] {
  if (points.length <= 2) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [i0, i1] = stack.pop() as [number, number]
    const a = points[i0] as Vec2
    const b = points[i1] as Vec2
    const len = dist(a, b)
    let best = -1
    let bestD = eps
    for (let i = i0 + 1; i < i1; i++) {
      const p = points[i] as Vec2
      // perpendicular distance, or distance to a when the segment is a point
      const d =
        len < 1e-12
          ? dist(a, p)
          : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len
      if (d > bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = true
      stack.push([i0, best], [best, i1])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** drop middle points that continue straight (turn angle under ~2°) */
function mergeCollinear(points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points
  const closed = dist(points[0] as Vec2, points[points.length - 1] as Vec2) < 1e-9
  const out: Vec2[] = [points[0] as Vec2]
  const last = points.length - (closed ? 2 : 1)
  for (let i = 1; i <= last; i++) {
    const a = out[out.length - 1] as Vec2
    const b = points[i] as Vec2
    const c = points[(i + 1) % points.length] as Vec2
    const v1 = Math.atan2(b.y - a.y, b.x - a.x)
    const v2 = Math.atan2(c.y - b.y, c.x - b.x)
    const turn = Math.abs((((v2 - v1) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI)
    if (turn > 0.035) out.push(b)
  }
  if (closed) out.push(out[0] as Vec2)
  return out
}

const pathLength = (points: Vec2[]): number => {
  let n = 0
  for (let i = 1; i < points.length; i++) n += dist(points[i - 1] as Vec2, points[i] as Vec2)
  return n
}

/**
 * Clean silk linework for the glyph vocabulary: Douglas–Peucker at 0.008·span,
 * merge near-collinear runs, drop strokes shorter than 0.03·span, and join
 * strokes whose endpoints touch within 0.01·span (so a box's four edges become
 * one closed stroke).
 */
export function simplifyStrokes(strokes: Vec2[][], span: number): Vec2[][] {
  const eps = 0.008 * span
  const minLen = 0.03 * span
  const joinEps = 0.01 * span
  const out = strokes
    .filter((s) => s.length >= 2)
    .map((s) => mergeCollinear(dp(s, eps)))
    .filter((s) => s.length >= 2 && pathLength(s) >= minLen)

  // join chains until nothing else touches — a rectangle's edges rejoin into a
  // ring, a chamfered corner keeps its diagonal
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < out.length; i++) {
      const a = out[i] as Vec2[]
      const a0 = a[0] as Vec2
      const a1 = a[a.length - 1] as Vec2
      for (let j = i + 1; j < out.length; j++) {
        const b = out[j] as Vec2[]
        const b0 = b[0] as Vec2
        const b1 = b[b.length - 1] as Vec2
        let joined: Vec2[] | undefined
        if (dist(a1, b0) < joinEps) joined = [...a, ...b.slice(1)]
        else if (dist(a1, b1) < joinEps) joined = [...a, ...[...b].reverse().slice(1)]
        else if (dist(a0, b0) < joinEps) joined = [...[...a].reverse(), ...b.slice(1)]
        else if (dist(a0, b1) < joinEps) joined = [...b, ...a.slice(1)]
        if (joined !== undefined) {
          out.splice(j, 1)
          out[i] = joined
          changed = true
          break outer
        }
      }
    }
  }
  return out
}
