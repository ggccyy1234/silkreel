import { describe, expect, it } from 'vitest'
import { DECODE_IN, DECODE_OUT, decodeAlpha } from './decode'

const STEPS = 168

describe('decode pattern banks', () => {
  it('every decode-in pattern lands on 1 and every decode-out lands on 0', () => {
    for (const p of DECODE_IN) expect(p.at(-1)).toBe(1)
    for (const p of DECODE_OUT) expect(p.at(-1)).toBe(0)
  })

  it('patterns only ever use the hard-blink alphabet {0, 0.35, 1}', () => {
    const allowed = new Set([0, 0.35, 1])
    for (const v of [...DECODE_IN, ...DECODE_OUT].flat()) {
      expect(allowed.has(v)).toBe(true)
    }
  })
})

describe('decodeAlpha', () => {
  it('plays the decode-in pattern at inStep, then holds at 1', () => {
    const pattern = 3
    const inStep = 20
    const outStep = 60
    for (let k = 0; k < 5; k++) {
      expect(decodeAlpha(inStep + k, inStep, outStep, pattern, STEPS)).toBe(DECODE_IN[pattern]?.[k])
    }
    for (const s of [26, 30, 59]) {
      expect(decodeAlpha(s, inStep, outStep, pattern, STEPS)).toBe(1)
    }
  })

  it('plays the decode-out pattern at outStep, then goes dark', () => {
    const pattern = 1
    const inStep = 20
    const outStep = 60
    for (let k = 0; k < 6; k++) {
      expect(decodeAlpha(outStep + k, inStep, outStep, pattern, STEPS)).toBe(DECODE_OUT[pattern]?.[k])
    }
    for (const s of [66, 100, 19]) {
      expect(decodeAlpha(s, inStep, outStep, pattern, STEPS)).toBe(0)
    }
  })

  it('wraps around the loop: a unit decoding in at step 165 is visible at step 0', () => {
    const inStep = 165
    const outStep = 30
    // step 0 is local 3 in a window of steps 165..167,0..2 — pattern index 3
    expect(decodeAlpha(0, inStep, outStep, 0, STEPS)).toBe(DECODE_IN[0]?.[3])
    // mid-hold after decode-in (local 5..hold): fully lit across the wrap
    for (const s of [2, 10, 29]) {
      expect(decodeAlpha(s, inStep, outStep, 0, STEPS)).toBe(1)
    }
    // decode-out at outStep, then dark until the wrap
    expect(decodeAlpha(30 + 6, inStep, outStep, 0, STEPS)).toBe(0)
    expect(decodeAlpha(164, inStep, outStep, 0, STEPS)).toBe(0)
  })

  it('mods the pattern index into the banks', () => {
    expect(decodeAlpha(20, 20, 60, 8, STEPS)).toBe(decodeAlpha(20, 20, 60, 2, STEPS))
  })

  it('smooth mode ramps monotonically in and out instead of blinking', () => {
    const inStep = 20
    const outStep = 60
    let prev = -1
    for (let f = 0; f <= 5; f += 0.25) {
      const a = decodeAlpha(inStep + f, inStep, outStep, 0, STEPS, true)
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = a
    }
    expect(decodeAlpha(inStep + 5, inStep, outStep, 0, STEPS, true)).toBe(1)
    prev = 2
    for (let f = 0; f <= 6; f += 0.25) {
      const a = decodeAlpha(outStep + f, inStep, outStep, 0, STEPS, true)
      expect(a).toBeLessThanOrEqual(prev + 1e-9)
      prev = a
    }
    expect(decodeAlpha(outStep + 6, inStep, outStep, 0, STEPS, true)).toBe(0)
  })

  it('twos mode only ever returns the blink alphabet', () => {
    for (let s = 0; s < STEPS; s++) {
      for (let p = 0; p < 6; p++) {
        const a = decodeAlpha(s, 20, 130, p, STEPS)
        expect([0, 0.35, 1]).toContain(a)
      }
    }
  })
})
