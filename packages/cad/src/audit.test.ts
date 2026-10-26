// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { auditBoard, expandVariables, rewriteModelPaths } from './audit.js'
import { requireComplete } from './prepare.js'

const folders: string[] = []
async function fixture(): Promise<string> {
  await mkdir('exports', { recursive: true })
  const folder = await mkdtemp(path.resolve('exports/cad-test-'))
  folders.push(folder)
  return folder
}
afterEach(async () => { await Promise.all(folders.splice(0).map(async p => rm(p, { recursive: true, force: true }))) })

describe('source-only model audit', () => {
  it('preserves original quoting/formatting and changes only actual model path tokens', () => {
    const source = '(kicad_pcb\n (layers (0 "F.Cu" signal "F.Copper"))\n (property "x" "(model fake.step)")\n (footprint "A" (model "${LIB}/part.step" (offset (xyz 1 2 3)))))'
    const result = rewriteModelPaths(source, ['C:/models/real.step'])
    expect(result).toBe(source.replace('"${LIB}/part.step"', '"C:/models/real.step"'))
  })

  it('records explicit transforms, hashes exact files, and respects disabled models', async () => {
    const folder = await fixture()
    await writeFile(path.join(folder, 'part.step'), 'real-file-placeholder')
    const input = path.join(folder, 'board.kicad_pcb')
    const text = '(kicad_pcb (footprint "Library:Part" (layer "B.Cu") (at 10 20 -35) (property "Reference" "U1") (property "Value" "MCU") (property "MPN" "STM32F103C8T6") (property "Manufacturer" "ST") (property "LCSC" "C8734") (property "Package" "LQFP-48") (model "${KIPRJMOD}/part.step" (offset (xyz 1 2 3)) (scale (xyz 1 2 0.5)) (rotate (xyz 4 5 6))) (model "missing.step" (hide yes))) (footprint "Hole" (property "Reference" "H1")))'
    await writeFile(input, text)
    const { audit, stagedSource } = await auditBoard(input, {})
    expect(audit.models).toHaveLength(2)
    expect(audit.models[0]).toMatchObject({ ref: 'U1', side: 'B.Cu', position: [10, 20, -35], offset: [1, 2, 3], scale: [1, 2, 0.5], rotation: [4, 5, 6] })
    expect(audit.models[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.missing).toHaveLength(0)
    expect(audit.footprints[0]).toMatchObject({ reference: 'U1', value: 'MCU', mpn: 'STM32F103C8T6',
      manufacturer: 'ST', lcsc: 'C8734', package: 'LQFP-48', padCount: 0, npthOnly: false })
    expect(audit.withoutModels).toEqual(['H1'])
    expect(stagedSource).toContain('missing.step')
    expect(await readFile(input, 'utf8')).toBe(text)
  })

  it('does not search for same-name files or substitute WRL/STEP extensions', async () => {
    const folder = await fixture()
    await writeFile(path.join(folder, 'part.step'), 'present')
    await writeFile(path.join(folder, 'board.kicad_pcb'), '(kicad_pcb (footprint "P" (property "Reference" "U2") (model "${UNKNOWN}/part.step")) (footprint "Q" (property "Reference" "U3") (model "part.wrl")))')
    const { audit } = await auditBoard(path.join(folder, 'board.kicad_pcb'), {})
    expect(audit.missing.map(m => m.ref)).toEqual(['U2', 'U3'])
    expect(() => { requireComplete(audit) }).toThrow(/Rendering stopped/)
    const mapped = await auditBoard(path.join(folder, 'board.kicad_pcb'), {}, { '${UNKNOWN}/part.step': path.join(folder, 'part.step'), 'part.wrl': path.join(folder, 'part.step') })
    expect(mapped.audit.missing).toEqual([])
  })

  it('expands known nested variables, retains unknowns, rejects cycles', () => {
    expect(expandVariables('${A}/x.step', { A: '${B}', B: '/models' })).toBe('/models/x.step')
    expect(expandVariables('${MISSING}/x.step', {})).toBe('${MISSING}/x.step')
    expect(() => expandVariables('${A}', { A: '${B}', B: '${A}' })).toThrow(/Cyclic/)
    expect(() => expandVariables('${A}', { A: '${A}' })).toThrow(/Cyclic/)
  })
})
