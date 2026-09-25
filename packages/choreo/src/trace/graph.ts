import type { Vec2 } from '@silk-reel/ingest'

export interface GraphSeg { layer: string; a: Vec2; b: Vec2; width: number }
/** via or through-hole pad: joins every layer within r of pos */
export interface GraphLink { pos: Vec2; r: number }
export interface GraphSeed { layer: string; pos: Vec2 }
export interface GrowthResult {
  /** per seg: distance (mm of copper travelled) when growth reaches its start end */
  start: number[]
  /** per seg: true when growth runs b→a */
  flipped: boolean[]
  /** per link: distance when first reached */
  linkTime: number[]
  maxDist: number
}

const Q = 100 // 0.01 mm snapping
const key = (layer: string, p: Vec2): string => `${layer}|${Math.round(p.x * Q)}|${Math.round(p.y * Q)}`

class Heap {
  private a: Array<[number, number]> = []
  get size(): number { return this.a.length }
  push(d: number, n: number): void {
    const a = this.a
    a.push([d, n])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if ((a[p] as [number, number])[0] <= d) break
      ;[a[p], a[i]] = [a[i] as [number, number], a[p] as [number, number]]
      i = p
    }
  }
  pop(): [number, number] {
    const a = this.a
    const top = a[0] as [number, number]
    const last = a.pop() as [number, number]
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && (a[l] as [number, number])[0] < (a[m] as [number, number])[0]) m = l
        if (r < a.length && (a[r] as [number, number])[0] < (a[m] as [number, number])[0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i] as [number, number], a[m] as [number, number]]
        i = m
      }
    }
    return top
  }
}

export function growthSchedule(segs: GraphSeg[], links: GraphLink[], seeds: GraphSeed[], origin: Vec2): GrowthResult {
  const ids = new Map<string, number>()
  const pos: Vec2[] = []
  const node = (layer: string, p: Vec2): number => {
    const k = key(layer, p)
    let id = ids.get(k)
    if (id === undefined) {
      id = pos.length
      ids.set(k, id)
      pos.push(p)
    }
    return id
  }
  const adj: Array<Array<[number, number]>> = []
  const edge = (u: number, v: number, w: number): void => {
    ;(adj[u] ??= []).push([v, w])
    ;(adj[v] ??= []).push([u, w])
  }
  const ends: Array<[number, number]> = segs.map((s) => {
    const u = node(s.layer, s.a)
    const v = node(s.layer, s.b)
    edge(u, v, Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y))
    return [u, v]
  })
  // links: a virtual node joined at zero cost to every endpoint within r (any layer)
  // ponytail: O(links × nodes) scan; switch to a spatial hash if the 5.8MB board is slow
  const nodeCount = pos.length
  const linkNode = links.map((l) => {
    const id = pos.length
    pos.push(l.pos)
    for (let n = 0; n < nodeCount; n++) {
      const p = pos[n] as Vec2
      if (Math.abs(p.x - l.pos.x) <= l.r && Math.abs(p.y - l.pos.y) <= l.r && Math.hypot(p.x - l.pos.x, p.y - l.pos.y) <= l.r) edge(id, n, 0)
    }
    return id
  })
  const dist = new Array<number>(pos.length).fill(Infinity)
  const heap = new Heap()
  const settle = (): void => {
    while (heap.size > 0) {
      const [d, u] = heap.pop()
      if (d > (dist[u] as number)) continue
      for (const [v, w] of adj[u] ?? []) {
        const nd = d + w
        if (nd < (dist[v] as number)) {
          dist[v] = nd
          heap.push(nd, v)
        }
      }
    }
  }
  for (const s of seeds) {
    // a seed pad catches every endpoint on its layer within 0.5 mm
    for (let n = 0; n < nodeCount; n++) {
      const p = pos[n] as Vec2
      if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) <= 0.5 && (dist[n] as number) > 0) {
        dist[n] = 0
        heap.push(0, n)
      }
    }
  }
  settle()
  // islands: seed each unreached component at its node nearest the origin,
  // starting at its euclidean distance — copper "jumps" outward in order
  for (;;) {
    let best = -1
    let bestD = Infinity
    for (let n = 0; n < nodeCount; n++) {
      if (dist[n] !== Infinity) continue
      const p = pos[n] as Vec2
      const d = Math.hypot(p.x - origin.x, p.y - origin.y)
      if (d < bestD) { bestD = d; best = n }
    }
    if (best < 0) break
    dist[best] = bestD
    heap.push(bestD, best)
    settle()
  }
  const start: number[] = []
  const flipped: boolean[] = []
  let maxDist = 0
  segs.forEach((s, i) => {
    const [u, v] = ends[i] as [number, number]
    const du = dist[u] as number
    const dv = dist[v] as number
    flipped.push(dv < du)
    start.push(Math.min(du, dv))
    maxDist = Math.max(maxDist, Math.max(du, dv))
  })
  return { start, flipped, linkTime: linkNode.map((id) => dist[id] as number), maxDist }
}
