import type { Arc, BoardModel, Vec2 } from '@silk-reel/ingest'
import type { FlatPath, TitleCard } from './types'

/** flatten an arc to a ~12-segment polyline */
function arcPoints(arc: Arc): Vec2[] {
  const pts: Vec2[] = []
  const sweep = arc.endAngle - arc.startAngle
  const n = Math.max(3, Math.round((Math.abs(sweep) / (Math.PI * 2)) * 12) || 3)
  for (let i = 0; i <= n; i++) {
    const a = arc.startAngle + (sweep * i) / n
    pts.push({ x: arc.center.x + Math.cos(a) * arc.radius, y: arc.center.y + Math.sin(a) * arc.radius })
  }
  return pts
}

export interface GhostBinGeo {
  /** silk strokes in stage units */
  strokes: FlatPath[]
  hero: boolean
  /** centroid distance from centre, for center-out cascade ranking */
  dist: number
}

export interface GhostGeometry {
  bins: GhostBinGeo[]
  label: TitleCard | undefined
  labelPos: { x: number; y: number }
}

/**
 * The ghost: the board's own front silkscreen (back if front is empty) shrunk
 * to a 0.55 half-extent and binned into ≤12 decode units. Silk lines belonging
 * to cast footprints become hero bins — the real chip sits inside the
 * constellation.
 */
export function buildGhostGeometry(
  board: BoardModel,
  heroRefs: Set<string>,
  title: TitleCard | undefined,
  stageAspect: number
): GhostGeometry {
  const silk = (prefix: string) =>
    Object.entries(board.silkscreen)
      .filter(([id]) => id.startsWith(prefix))
      .flatMap(([, layer]) => [
        ...layer.lines.map((l) => ({ id: l.id, points: l.points })),
        ...layer.arcs.map((a) => ({ id: a.id, points: arcPoints(a) }))
      ])
      .filter((s) => s.points.length >= 2)
  const strokes = silk('F.')
  const raw = strokes.length > 0 ? strokes : silk('B.')
  if (raw.length === 0) return { bins: [], label: title, labelPos: { x: 0, y: 0.63 } }

  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  for (const s of raw) {
    for (const p of s.points) {
      if (p.x < min.x) min.x = p.x
      if (p.y < min.y) min.y = p.y
      if (p.x > max.x) max.x = p.x
      if (p.y > max.y) max.y = p.y
    }
  }
  const bw = Math.max(1e-6, max.x - min.x)
  const bh = Math.max(1e-6, max.y - min.y)
  // rotate the long axis onto the frame's spread axis when it fills better
  const sx = stageAspect > 1 ? Math.min(1.15, stageAspect) : 1
  const sy = stageAspect < 1 ? Math.min(1.15, 1 / stageAspect) : 1
  const rotated = sx > 1 ? bh > bw : sy > 1 ? bw > bh : false
  const w = rotated ? bh : bw
  const h = rotated ? bw : bh
  const scale = 1.1 / Math.max(w, h)
  const cx = (min.x + max.x) / 2
  const cy = (min.y + max.y) / 2
  const map = (p: Vec2): Vec2 => {
    const dx = p.x - cx
    const dy = p.y - cy
    // apply the same aspect spread the formations get so the ghost shares the stage
    return rotated
      ? { x: -dy * scale * sx, y: dx * scale * sy }
      : { x: dx * scale * sx, y: dy * scale * sy }
  }

  // hero strokes: silk owned by the footprints that made the cast
  const ownerOf = new Map<string, string>()
  for (const fp of board.footprints) {
    if (!heroRefs.has(fp.ref)) continue
    for (const ref of fp.silkRefs) ownerOf.set(ref, fp.ref)
  }
  const heroByFp = new Map<string, Vec2[][]>()
  const rest: Vec2[][] = []
  for (const s of raw) {
    const fp = ownerOf.get(s.id)
    if (fp === undefined) {
      rest.push(s.points)
      continue
    }
    const list = heroByFp.get(fp)
    if (list === undefined) heroByFp.set(fp, [s.points])
    else list.push(s.points)
  }

  const flat = (pts: Vec2[]): FlatPath => pts.flatMap((p) => [map(p).x, map(p).y])
  const centroid = (strokes: FlatPath[]): Vec2 => {
    let x = 0
    let y = 0
    let n = 0
    for (const s of strokes) {
      for (let i = 0; i + 1 < s.length; i += 2) {
        x += s[i] as number
        y += s[i + 1] as number
        n++
      }
    }
    return n === 0 ? { x: 0, y: 0 } : { x: x / n, y: y / n }
  }

  // hero bins first (≤4 — one per footprint, cast order); the rest is a
  // position grid capped so the whole ghost stays ≤12 bins
  const heroBins: GhostBinGeo[] = []
  for (const [i, pts] of [...heroByFp.values()].entries()) {
    if (i >= 4) {
      rest.push(...pts)
      continue
    }
    const strokes = pts.map(flat)
    const c = centroid(strokes)
    heroBins.push({ strokes, hero: true, dist: Math.hypot(c.x, c.y) })
  }
  const cap = Math.max(1, 12 - heroBins.length)
  const cols = Math.max(1, Math.floor(Math.sqrt(cap)))
  const rows = Math.max(1, Math.floor(cap / cols))
  const grid = new Map<number, FlatPath[]>()
  for (const pts of rest) {
    const p = map(pts[Math.floor(pts.length / 2)] as Vec2)
    const qx = Math.min(cols - 1, Math.max(0, Math.floor(((p.x + 1.15) / 2.3) * cols)))
    const qy = Math.min(rows - 1, Math.max(0, Math.floor(((p.y + 1.15) / 2.3) * rows)))
    const key = qy * cols + qx
    const list = grid.get(key)
    if (list === undefined) grid.set(key, [flat(pts)])
    else list.push(flat(pts))
  }
  const bins: GhostBinGeo[] = [...heroBins]
  for (const strokes of grid.values()) {
    const c = centroid(strokes)
    bins.push({ strokes, hero: false, dist: Math.hypot(c.x, c.y) })
  }
  return { bins, label: title, labelPos: { x: 0, y: 0.63 } }
}
