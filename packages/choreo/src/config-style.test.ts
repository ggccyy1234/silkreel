import { describe, expect, it } from 'vitest'
import { resolveConfig, planDuration } from './config'
import { ChoreoConfigError } from './errors'

const base = { knobs: {}, seed: 1, duration: 'auto' as const, output: { width: 1080, height: 1350, fps: 30 } }

describe('style config', () => {
  it('defaults to trace + copper', () => {
    const r = resolveConfig(base)
    expect(r.style).toBe('trace')
    expect(r.palette.id).toBe('copper')
  })
  it('aspect overrides output size with a warning', () => {
    const r = resolveConfig({ ...base, aspect: '9:16' })
    expect([r.width, r.height]).toEqual([1080, 1920])
    expect(r.knobWarnings.some((w) => w.code === 'aspect-overrides-output')).toBe(true)
  })
  it('rejects a malformed accent', () => {
    expect(() => resolveConfig({ ...base, accent: 'red' })).toThrow(ChoreoConfigError)
  })
  it('tempo shortens trace duration', () => {
    const r = resolveConfig({ ...base, knobs: { tempo: 1.5 } })
    expect(planDuration(r).durationSeconds).toBeCloseTo(8, 1)
  })
})
