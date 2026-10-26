import { readFile, writeFile } from 'node:fs/promises'
import { Box3, Group, Mesh, MeshPhongMaterial, MeshStandardMaterial, Vector3 } from 'three'
import type { Material, Object3D } from 'three'
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GeometryInfo } from './types.js'

// GLTFExporter only needs Blob -> ArrayBuffer here; no browser/DOM is used.
class BlobReader {
  result: ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() })
  }
}

export function vrmlScene(source: string): Object3D {
  // Unsupported nodes must fail rather than silently dropping source geometry.
  const withoutComments = source.replace(/#[^\n]*/g, '')
  if (/\b(?:Inline|ImageTexture|PixelTexture|Text|Extrusion|ElevationGrid|LOD|Switch|Billboard)\s*\{/.test(withoutComments)) {
    throw new Error('VRML has external or unsupported nodes; use an embedded KiCad VRML export')
  }
  const scene = new VRMLLoader().parse(source, '')
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh
    const convert = (m: Material): Material => {
      if (!(m instanceof MeshPhongMaterial)) return m
      // Explicit Phong->glTF conversion; CAD diffuse/emissive/opacity retained.
      return new MeshStandardMaterial({ name: m.name, color: m.color, emissive: m.emissive,
        opacity: m.opacity, transparent: m.transparent, side: m.side,
        vertexColors: m.vertexColors, roughness: Math.sqrt(2 / (m.shininess + 2)), metalness: 0 })
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material)
  })
  return scene
}

export function geometryInfo(scene: Object3D): GeometryInfo {
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene, true)
  if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) throw new Error('Model has empty or non-finite geometry')
  const size = box.getSize(new Vector3())
  const materials = new Set<Material>()
  let meshes = 0, triangles = 0
  scene.traverse(object => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh
    meshes++
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
  })
  if (!meshes || !triangles) throw new Error('No renderable mesh triangles')
  return { meshes, triangles, materials: materials.size,
    bounds: { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray() } }
}

export async function glbSceneMm(input: string): Promise<Object3D> {
  const bytes = await readFile(input)
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const result = await new GLTFLoader().parseAsync(data, '')
  result.scene.scale.multiplyScalar(1000)
  return result.scene
}

export async function writeGlb(sceneMm: Object3D, output: string): Promise<void> {
  const previous = globalThis.FileReader
  globalThis.FileReader = BlobReader as unknown as typeof FileReader
  const meters = new Group()
  meters.scale.setScalar(0.001)
  meters.add(sceneMm)
  try {
    const data = await new GLTFExporter().parseAsync(meters, { binary: true, onlyVisible: true })
    if (!(data instanceof ArrayBuffer)) throw new Error('Expected a binary glTF result')
    await writeFile(output, new Uint8Array(data))
  } finally {
    meters.remove(sceneMm)
    globalThis.FileReader = previous
  }
}
