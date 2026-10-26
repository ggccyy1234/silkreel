// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readStack } from './manufacturing.js'
import { processState, PROCESS_STAGES } from './manufacturing-scene.js'
import { manufacturingPlan } from './manufacturing-plan.js'
import type { ManufacturingData } from './manufacturing.js'
import { requireQualifiedStack } from './compatibility.js'

describe('source stackup and manufacturing choreography', () => {
  it('rejects unqualified layer counts and ambiguous layer sequences before rendering', () => {
    const stack = (count: number) => Array.from({ length: count * 2 - 1 }, (_, i) => ({
      name: i % 2 ? `dielectric ${i}` : i === 0 ? 'F.Cu' : i === count * 2 - 2 ? 'B.Cu' : `In${i / 2}.Cu`,
      type: i % 2 ? 'core' : 'copper', thickness: i % 2 ? 0.1 : 0.035, z: 0
    }))
    for (const count of [4, 6]) expect(() => { requireQualifiedStack(stack(count)) }).not.toThrow()
    for (const count of [2, 8, 10]) expect(() => { requireQualifiedStack(stack(count)) }).toThrow('qualified')
    const bad = stack(4)
    if (bad[1]) bad[1].thickness = Infinity
    expect(() => { requireQualifiedStack(bad) }).toThrow('Unsupported stackup')
    expect(() => { requireQualifiedStack(stack(4).reverse()) }).toThrow('Unsupported stackup')
  })
  it('uses the explicit asymmetric laminate thicknesses and KiCad copper origin', () => {
    const layers = readStack('(kicad_pcb (setup (stackup (layer "F.Cu" (type "copper") (thickness 0.035)) (layer "dielectric 1" (type "core") (thickness 0.71)) (layer "B.Cu" (type "copper") (thickness 0.035)))))')
    expect(layers.map(l => l.thickness)).toEqual([0.035, 0.71, 0.035])
    expect(layers[0]?.z).toBeCloseTo(0.71)
    expect(layers[1]?.z).toBeCloseTo(0)
    expect(layers[2]?.z).toBeCloseTo(-0.035)
    expect(() => readStack('(kicad_pcb (setup))')).toThrow('explicit')
  })
  it('explodes then assembles and shows both board faces for SMT', () => {
    expect(processState(0).explosion).toBe(0)
    expect(processState(9 / 48).explosion).toBe(1)
    expect(processState(26 / 48).explosion).toBe(0)
    expect(processState(34 / 48).elevation).toBeLessThan(0)
    expect(processState(41 / 48).elevation).toBeGreaterThan(0)
    expect(processState(1).stage).toBe(PROCESS_STAGES.length - 1)
    expect(PROCESS_STAGES.map(s => s[0])).toEqual([...PROCESS_STAGES.map(s => s[0])].sort((a, b) => a - b))
  })
  it('separates single-sided SMT from through-hole insertion and does not invent bottom assembly', () => {
    const data = { title: 'PMIC', stack: [{ type: 'copper' }, { type: 'core' }, { type: 'copper' }],
      footprints: { U1: { side: 'top', mount: 'smd' }, TP1: { side: 'top', mount: 'through-hole' } },
      nodes: { 0: { kind: 'component', ref: 'U1' }, 1: { kind: 'component', ref: 'TP1' } },
      layers: { 'F.Paste': [{}] } } as unknown as ManufacturingData
    const plan = manufacturingPlan(data)
    expect(plan.duration).toBe(44)
    expect(plan.placements.map(p => p.mount)).toEqual(['smd', 'through-hole'])
    expect(plan.stages.some(s => s[1].includes('底面'))).toBe(false)
    expect(processState(34 / plan.duration, plan).elevation).toBe(42)
    data.footprints.TP1 = { side: 'bottom', mount: 'smd', position: [0, 0] }
    data.layers['B.Paste'] = [{ outer: [], holes: [] }]
    const double = manufacturingPlan(data)
    expect(double.duration).toBe(48)
    expect(processState(34 / double.duration, double).elevation).toBe(-46)
    expect(processState(41 / double.duration, double).elevation).toBe(42)
  })
})
