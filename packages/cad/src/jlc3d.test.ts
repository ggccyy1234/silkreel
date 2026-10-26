// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exactProduct, parseJlcTransform, readJlcConfig, safeModelName } from './jlc3d.js'

describe('JLC3D interface', () => {
  it('sanitizes model names while preserving the LCSC identifier', () => {
    expect(safeModelName('C8734', 'USB / Type-C: receptacle')).toBe('C8734_USB_Type-C_receptacle.step')
  })

  it('reads the local JLC3D download path without case-sensitive key assumptions', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'silkreel-jlc-'))
    const file = path.join(dir, 'config.ini')
    await writeFile(file, '[PATH]\ndownloadpath = C:/models/3d\n', 'utf8')
    expect(await readJlcConfig(file)).toBe('C:/models/3d')
  })

  it('returns null for a missing JLC3D configuration', async () => {
    expect(await readJlcConfig(path.join(tmpdir(), 'definitely-missing-jlc3d.ini'))).toBeNull()
  })

  it('matches an exact MPN and refuses ambiguous package variants', () => {
    const payload = { result: { productList: [
      { code: 'C1', model: 'ABC', standard: 'QFN-16', hasDevice: 'one' },
      { code: 'C2', model: 'ABC', standard: 'TSSOP-16', hasDevice: 'two' }
    ] } }
    expect(() => exactProduct(payload, 'ABC')).toThrow('ambiguous')
    expect(exactProduct(payload, 'ABC', 'TSSOP-16')).toMatchObject({ code: 'C2' })
    expect(exactProduct({ result: { productList: [{ code: 'C3', model: 'XYZ', hasDevice: 'three' }] } }, 'xyz'))
      .toMatchObject({ code: 'C3' })
  })

  it('decodes the EasyEDA size/rotation/offset tuple', () => {
    expect(parseJlcTransform('63.7794,31.496,0,90,0,0,-4.528,0,0')).toEqual({
      raw: '63.7794,31.496,0,90,0,0,-4.528,0,0',
      sizeMil: [63.7794, 31.496, 0],
      rotationEasyEda: [0, 0, 90],
      offsetMil: [-4.528, 0, 0]
    })
    expect(() => parseJlcTransform('1,2,3')).toThrow('Invalid')
  })
})
