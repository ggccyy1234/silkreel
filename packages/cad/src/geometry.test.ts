// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { Mesh, MeshStandardMaterial } from 'three'
import { geometryInfo, glbSceneMm, vrmlScene, writeGlb } from './geometry.js'
import { prepare } from './prepare.js'
import { nativePython } from './native.js'

describe('CAD geometry fidelity', () => {
  it('retains nested VRML transforms, color, alpha and millimetres through GLB', async () => {
    await mkdir('exports', { recursive: true })
    const scene = vrmlScene('#VRML V2.0 utf8\nTransform { translation 10 20 -3 scale 2 1 1 children [ Shape { appearance Appearance { material Material { diffuseColor 1 0 0 transparency 0.25 } } geometry Box { size 4 6 2 } } ] }')
    const before = geometryInfo(scene)
    expect(before.bounds.size).toEqual([8, 6, 2])
    expect(before.bounds.min).toEqual([6, 17, -4])
    const folder = await mkdtemp(path.resolve('exports/cad-geometry-'))
    try {
      const file = path.join(folder, 'geometry.glb')
      await writeGlb(scene, file)
      const loaded = await glbSceneMm(file)
      const after = geometryInfo(loaded)
      after.bounds.size.forEach((n, i) => { expect(n).toBeCloseTo(before.bounds.size[i] ?? 0, 4) })
      loaded.traverse(o => {
        if (!(o instanceof Mesh)) return
        const mesh = o as Mesh
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
        expect(material?.opacity).toBeCloseTo(0.75)
      })
      expect(after.triangles).toBe(before.triangles)
    } finally { await rm(folder, { recursive: true, force: true }) }
  })

  it('rejects VRML dependencies that would silently disappear', () => {
    expect(() => vrmlScene('#VRML V2.0 utf8\nInline { url ["part.wrl"] }')).toThrow(/unsupported/)
  })

  it('imports a real STEP assembly with two locations and per-face CAD colors', async context => {
    // Native integration is opt-in on machines without the optional STEP runtime.
    const native = await nativePython().catch(() => null)
    if (!native) { expect(process.env.CAD_REQUIRE_NATIVE_TESTS).not.toBe('1'); context.skip(); return }
    await mkdir('exports', { recursive: true })
    const out = await mkdtemp(path.resolve('exports/cad-step-test-'))
    try {
      const manifest = await prepare({ input: 'fixtures/cad/colored-assembly.step', out, python: native.python })
      expect(manifest.nativeReport?.failedFaces).toEqual([])
      expect(manifest.geometry.triangles).toBe(24)
      expect(manifest.nativeReport?.definitions).toBe(1)
      manifest.geometry.bounds.size.forEach((v, i) => { expect(v).toBeCloseTo([30, 8, 6][i] ?? 0, 4) })
      expect(manifest.geometry.materials).toBeGreaterThanOrEqual(2)
      expect(manifest.modelUnits).toBe('meter')
      const scene = await glbSceneMm(path.join(out, 'model.glb'))
      const colors: number[][] = []
      scene.traverse(object => {
        if (!(object instanceof Mesh)) return
        const mesh = object as Mesh
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (m instanceof MeshStandardMaterial) colors.push(m.color.toArray())
        }
      })
      expect(colors.some(c => (c[0] ?? 0) > 0.99 && (c[1] ?? 1) < 0.01)).toBe(true)
      expect(colors.some(c => Math.abs((c[1] ?? 0) - 0.6) < 0.001)).toBe(true)
    } finally { await rm(out, { recursive: true, force: true }) }
  }, 30000)
})
