import { describe, expect, it } from 'vitest'
import { resolvePalette, PALETTES } from './palette'

describe('resolvePalette', () => {
  it('defaults to copper for trace and mono for glyph', () => {
    expect(resolvePalette('trace', undefined, undefined).id).toBe('copper')
    expect(resolvePalette('glyph', undefined, undefined).id).toBe('mono')
  })
  it('accent overrides head and marks palette custom', () => {
    const p = resolvePalette('trace', 'blueprint', '#ff3366')
    expect(p.head).toBe('#ff3366')
    expect(p.id).toBe('custom')
    expect(p.bg).toBe(PALETTES.blueprint.bg)
  })
})
