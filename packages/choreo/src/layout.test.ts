import { describe, expect, it } from 'vitest'
import { ASPECT_SIZE, safeArea, fitBoard } from './layout'

describe('layout', () => {
  it('maps aspects to 1080-class sizes', () => {
    expect(ASPECT_SIZE['4:5']).toEqual({ width: 1080, height: 1350 })
    expect(ASPECT_SIZE['9:16']).toEqual({ width: 1080, height: 1920 })
    expect(ASPECT_SIZE['16:9']).toEqual({ width: 1920, height: 1080 })
    expect(ASPECT_SIZE['1:1']).toEqual({ width: 1080, height: 1080 })
  })
  it('fits a tall board into 16:9 by rotating it', () => {
    const f = fitBoard({ min: { x: 0, y: 0 }, max: { x: 20, y: 80 } }, 1920, 1080, false)
    expect(f.rotated).toBe(true)
    const p = f.map({ x: 10, y: 40 })
    expect(p.x).toBeCloseTo(960, 0)
    expect(p.y).toBeCloseTo(540, 0)
  })
  it('keeps the board inside the safe area', () => {
    const area = safeArea(1080, 1920, false)
    const f = fitBoard({ min: { x: 0, y: 0 }, max: { x: 100, y: 60 } }, 1080, 1920, false)
    for (const c of [{ x: 0, y: 0 }, { x: 100, y: 60 }]) {
      const p = f.map(c)
      expect(p.x).toBeGreaterThanOrEqual(area.x - 0.5)
      expect(p.x).toBeLessThanOrEqual(area.x + area.w + 0.5)
      expect(p.y).toBeGreaterThanOrEqual(area.y - 0.5)
      expect(p.y).toBeLessThanOrEqual(area.y + area.h + 0.5)
    }
  })
})
