export interface Rng {
  next(): number
  range(min: number, max: number): number
  int(minInclusive: number, maxExclusive: number): number
  pick<T>(items: T[]): T
  shuffle<T>(items: T[]): T[]
}

export function mulberry32(seedValue: number): () => number {
  let a = seedValue >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRng(seed: number | null, streamId: string): Rng {
  const baseSeed = seed === null ? organicSeed() : seed
  const streamSeed = mixSeed(baseSeed, hashString(streamId))
  const draw = mulberry32(streamSeed)
  return {
    next: draw,
    range: (min, max) => min + draw() * (max - min),
    int: (minInclusive, maxExclusive) => minInclusive + Math.floor(draw() * Math.max(1, maxExclusive - minInclusive)),
    pick: <T,>(items: T[]) => {
      if (items.length === 0) throw new Error('rng.pick on empty array')
      return items[Math.floor(draw() * items.length)] as T
    },
    shuffle: <T,>(items: T[]) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(draw() * (i + 1))
        const tmp = out[i] as T
        out[i] = out[j] as T
        out[j] = tmp
      }
      return out
    }
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mixSeed(a: number, b: number): number {
  let x = (a ^ b) >>> 0
  x = Math.imul(x ^ (x >>> 16), 2246822507)
  x = Math.imul(x ^ (x >>> 13), 3266489909)
  return (x ^ (x >>> 16)) >>> 0
}

export function organicSeed(): number {
  const timePart = Date.now() % 2147483647
  const perfPart = Math.floor(performance.now() * 1000) % 1048576
  return mixSeed(timePart, perfPart * 2654435761)
}
