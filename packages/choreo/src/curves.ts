export const mod = (a: number, n: number): number => ((a % n) + n) % n

export function smooth01(t: number): number {
  return t * t * (3 - 2 * t)
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
