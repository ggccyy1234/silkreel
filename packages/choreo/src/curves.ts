import type { EasingName, PaletteDef, PaletteName, Rgb } from './types'

export function ease(t: number, name: EasingName): number {
  const x = clamp01(t)
  switch (name) {
    case 'linear':
      return x
    case 'sine':
      return -(Math.cos(Math.PI * x) - 1) / 2
    case 'expo-out':
      return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)
    case 'back-out': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
    }
    default: {
      const never: never = name
      throw new Error(`unknown easing ${String(never)}`)
    }
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export interface PaletteSpec {
  stroke: Rgb
  glowHue: Rgb
}

const PALETTES: Record<PaletteName, PaletteDef> = {
  mono: { name: 'mono', stroke: { r: null, g: null, b: null }, glowHue: { r: null, g: null, b: null } },
  phosphor: { name: 'phosphor', stroke: { r: 64, g: 255, b: 128 }, glowHue: { r: 40, g: 220, b: 120 } },
  amber: { name: 'amber', stroke: { r: 255, g: 176, b: 59 }, glowHue: { r: 240, g: 150, b: 40 } },
  copper: { name: 'copper', stroke: { r: 224, g: 138, b: 88 }, glowHue: { r: 200, g: 110, b: 60 } }
}

export function resolvePalette(name: PaletteName | undefined): PaletteDef {
  return PALETTES[name ?? 'mono']
}

export function paletteIsGrayscale(p: PaletteDef): boolean {
  return p.stroke.r === null && p.stroke.g === null && p.stroke.b === null
}
