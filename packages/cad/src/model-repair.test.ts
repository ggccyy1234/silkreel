// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { injectModelDeclarations } from './model-repair.js'
import type { FootprintIdentity } from './types.js'

const identity = (reference: string): FootprintIdentity => ({
  reference, footprint: `Library:${reference}`, side: 'F.Cu', value: null, mpn: null,
  manufacturer: null, supplierPart: null, lcsc: null, package: null, padCount: 1,
  npthOnly: false, properties: {}
})

describe('project-local model injection', () => {
  it('inserts a model only into the selected footprint and leaves bytes outside it intact', () => {
    const source = '(kicad_pcb\n  (version 20240108)\n  (footprint "A" (layer "F.Cu") (property "Reference" "U1"))\n  (footprint "B" (layer "F.Cu") (property "Reference" "U2"))\n)'
    const result = injectModelDeclarations(source, [identity('U1'), identity('U2')], {
      U2: { path: 'C:/models/U2.step', offset: [1, -2, 0.1], scale: [1, 0.5, 1], rotate: [0, 0, 270] }
    })
    expect(result.startsWith(source.slice(0, source.indexOf('(footprint "B"')))).toBe(true)
    expect(result).toContain('(offset (xyz 1 -2 0.1))')
    expect(result).toContain('(scale (xyz 1 0.5 1))')
    expect(result).toContain('(rotate (xyz 0 0 270))')
    expect(result.match(/\(model /g)).toHaveLength(1)
    expect(result.endsWith(')')).toBe(true)
  })
})
