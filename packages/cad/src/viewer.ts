import { ACESFilmicToneMapping, AmbientLight, Box3, Color, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Manifest, ViewSettings } from './types.js'
import { manufacturingScene } from './manufacturing-scene.js'
import type { ManufacturingData } from './manufacturing.js'

declare global {
  interface Window {
    cadReady?: boolean
    cadError?: string
    cadFrame?: (progress: number, settings: ViewSettings) => void
    cadAssemblyState?: () => { translated: number; visible: number }
    cadFrameHealth?: () => { visibleMeshes: number; clipped: boolean; bounds: number[] }
  }
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`Missing viewer element ${selector}`)
  return found
}

async function main(): Promise<void> {
  const canvas = element('canvas') as HTMLCanvasElement
  const status = element('#status')
  const state = await fetch('status.json').then(async r => await r.json() as { ok: boolean; error?: string })
  if (!state.ok) throw new Error(state.error ?? 'The last CAD job failed; stale model is not displayed')
  const manifest = await fetch('manifest.json').then(async response => {
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`)
    return await response.json() as Manifest
  })
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.setPixelRatio(1)
  renderer.localClippingEnabled = true
  const scene = new Scene()
  const modelResponse = await fetch(manifest.model)
  if (!modelResponse.ok) throw new Error(`Model HTTP ${modelResponse.status}`)
  const modelBytes = await modelResponse.arrayBuffer()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', modelBytes))
  const hash = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
  if (hash !== manifest.modelSha256) throw new Error('模型文件与来源记录的 SHA-256 不一致')
  const gltf = await new GLTFLoader().parseAsync(modelBytes, '')
  const source = gltf.scene
  // CAD layers can be only micrometres apart. Transparent surfaces must not
  // write depth: centroid sorting alone can otherwise erase visible silkscreen
  // when an almost opaque board/mask is drawn first at an oblique angle.
  // Preserve source opacity, geometry and depth testing.
  source.traverse(object => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.transparent) material.depthWrite = false
    }
  })
  source.scale.multiplyScalar(1000) // glTF metres -> display CAD millimetres.
  source.updateMatrixWorld(true)
  const box = new Box3().setFromObject(source, true)
  const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3())
  // KiCad explicitly names these STEP layer meshes. Their centroids differ in
  // XY, so Three.js's distance-to-centroid ordering can draw an almost opaque
  // laminate over the front silkscreen. Order only these named transparent
  // layers by their physical side; arbitrary component materials stay intact.
  const cadDocument = gltf.parser.json as { meshes?: { name?: string }[] }
  const layerMeshes: { mesh: Mesh; kind: string; z: number }[] = []
  source.traverse(object => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh
    const meshIndex = gltf.parser.associations.get(object)?.meshes
    const name = meshIndex === undefined ? '' : cadDocument.meshes?.[meshIndex]?.name ?? ''
    const kind = /_(PCB|soldermask|silkscreen)$/.exec(name)?.[1]
    if (kind) layerMeshes.push({ mesh, kind, z: new Box3().setFromObject(mesh, true).getCenter(new Vector3()).z })
  })
  const laminateZ = layerMeshes.find(layer => layer.kind === 'PCB')?.z
  const radius = size.length() / 2
  if (!(radius > 0)) throw new Error('Empty CAD bounding box')
  let manufacturing: ReturnType<typeof manufacturingScene> | undefined
  if (manifest.manufacturing) {
    const response = await fetch(manifest.manufacturing.file)
    if (!response.ok) throw new Error('Missing manufacturing geometry')
    const bytes = await response.arrayBuffer()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    if (Array.from(digest, v => v.toString(16).padStart(2, '0')).join('') !== manifest.manufacturing.sha256) throw new Error('Manufacturing source hash mismatch')
    manufacturing = manufacturingScene(source, gltf, JSON.parse(new TextDecoder().decode(bytes)) as ManufacturingData, center)
    window.cadAssemblyState = manufacturing.summary
  }
  // A presentation translation only, preserving all assembly transforms.
  const centered = new Group()
  centered.position.copy(center).negate()
  centered.add(source)
  if (manufacturing) centered.add(manufacturing.group)
  scene.add(centered)
  scene.add(new AmbientLight(0xffffff, 0.45))
  scene.add(new HemisphereLight(0xffffff, 0x969da8, 1.1))
  const key = new DirectionalLight(0xffffff, 3)
  key.position.set(-radius, -radius * 2, radius * 3)
  scene.add(key)
  const fill = new DirectionalLight(0xffffff, 1.5)
  fill.position.set(radius, radius, -radius * 2)
  scene.add(fill)
  // Keep a useful depth range for micrometre-separated copper/mask/silk faces.
  const camera = new PerspectiveCamera(32, 1, radius / 20, radius * 100)
  camera.up.set(0, 0, 1)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = false
  controls.minDistance = radius * 0.2
  controls.maxDistance = radius * 30
  const settings: ViewSettings = { width: innerWidth, height: innerHeight, elevation: 55, azimuth: -90,
    side: 'top', background: '#edf0f4', transparent: false, title: '', film: Boolean(manifest.manufacturing) }
  const title = element('#title')
  const draw = (progress: number, view: ViewSettings): void => {
    Object.assign(settings, view)
    const process = manufacturing?.update(Math.max(0, Math.min(1, progress)), Boolean(view.film))
    renderer.setSize(view.width, view.height, false)
    renderer.setClearColor(new Color(view.background), view.transparent ? 0 : 1)
    camera.aspect = view.width / view.height
    camera.updateProjectionMatrix()
    const verticalHalfFov = camera.fov * Math.PI / 360
    const halfFov = Math.min(verticalHalfFov, Math.atan(Math.tan(verticalHalfFov) * camera.aspect))
    const distance = radius / Math.sin(halfFov) * 1.12 * (view.film ? process?.zoom ?? 1 : 1)
    const elevation = (view.film ? process?.elevation ?? view.elevation : view.elevation) * Math.PI / 180 * (view.side === 'bottom' ? -1 : 1)
    const angle = view.azimuth * Math.PI / 180 + progress * 2 * Math.PI * (view.film ? 1.6 : 1) + (view.side === 'bottom' ? Math.PI : 0)
    camera.position.set(Math.cos(elevation) * Math.cos(angle), Math.cos(elevation) * Math.sin(angle), Math.sin(elevation)).multiplyScalar(distance)
    controls.target.set(0, 0, 0)
    camera.lookAt(0, 0, 0)
    if (laminateZ !== undefined) {
      const side = camera.position.z >= laminateZ - center.z ? 1 : -1
      for (const layer of layerMeshes) layer.mesh.renderOrder = layer.kind === 'PCB' ? 0
        : (layer.z >= laminateZ ? 1 : -1) * side * (layer.kind === 'silkscreen' ? 3 : 2)
    }
    controls.update()
    title.textContent = view.film ? '' : view.title
    if (view.film) { camera.setViewOffset(view.width, view.height, -view.width * 0.05, -view.height * 0.015, view.width, view.height) }
    else camera.clearViewOffset()
    renderer.render(scene, camera)
  }
  window.cadFrame = draw
  window.cadFrameHealth = () => {
    let visibleMeshes = 0
    const bounds = [Infinity, Infinity, -Infinity, -Infinity]
    centered.traverseVisible(object => {
      if (!(object instanceof Mesh)) return
      const mesh = object as Mesh
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      if (!box || box.isEmpty()) return
      visibleMeshes++
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new Vector3(x, y, z).applyMatrix4(object.matrixWorld).project(camera)
        bounds[0] = Math.min(bounds[0] ?? Infinity, p.x); bounds[1] = Math.min(bounds[1] ?? Infinity, p.y)
        bounds[2] = Math.max(bounds[2] ?? -Infinity, p.x); bounds[3] = Math.max(bounds[3] ?? -Infinity, p.y)
      }
    })
    return { visibleMeshes, bounds, clipped: bounds.some(v => !Number.isFinite(v))
      || (bounds[0] ?? 0) < -1.005 || (bounds[1] ?? 0) < -1.005 || (bounds[2] ?? 0) > 1.005 || (bounds[3] ?? 0) > 1.005 }
  }
  const render = (): void => { renderer.render(scene, camera) }
  controls.addEventListener('change', render)
  draw(0, settings)
  let meshCount = 0, triangles = 0
  source.traverse(o => {
    if (!(o instanceof Mesh)) return
    const mesh = o as Mesh
    meshCount++
    triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
  })
  status.textContent = `${size.toArray().map(v => v.toFixed(2)).join(' × ')} mm · ${meshCount} meshes · ${triangles.toLocaleString()} triangles`
  element('#source').textContent = `${manifest.input.split(/[\\/]/).pop()} · ${manifest.inputSha256.slice(0, 12)}`
  const notice = manifest.audit?.withoutModels.length
    ? `PCB 中 ${manifest.audit.withoutModels.length} 个封装未配置可见模型；工具没有补造器件。`
    : manifest.sourceKind === 'step' ? '显示 STEP 文件已包含的几何与颜色；文件中没有的铜层、丝印或器件无法恢复。' : ''
  element('#notice').textContent = notice
  element('#notes').textContent = manifest.notes.join('\n')
  const film = element('#film')
  film.hidden = !('render' in manifest && (manifest as Manifest & { render?: { duration?: number } }).render?.duration)
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    button.onclick = () => {
      settings.side = button.dataset.view === 'bottom' ? 'bottom' : 'top'
      settings.elevation = button.dataset.view === 'iso' ? 55 : 89.99
      settings.film = false
      draw(0, settings)
    }
  })
  let playing = false, started = 0, raf = 0
  const play = element('#play') as HTMLButtonElement
  const tick = (time: number): void => {
    if (!playing) return
    if (!started) started = time
    const cycle = (manifest.manufacturing?.duration ?? 12) * 1000
    draw(((time - started) % cycle) / cycle, settings)
    raf = requestAnimationFrame(tick)
  }
  play.onclick = () => {
    settings.film = Boolean(manifest.manufacturing)
    playing = !playing
    play.textContent = playing ? '暂停' : '转台'
    started = 0
    if (playing) raf = requestAnimationFrame(tick)
    else cancelAnimationFrame(raf)
  }
  element('#save').onclick = () => {
    render()
    const link = document.createElement('a')
    link.download = 'pcb-cad.png'; link.href = canvas.toDataURL('image/png'); link.click()
  }
  addEventListener('resize', () => {
    settings.width = innerWidth; settings.height = innerHeight
    renderer.setSize(innerWidth, innerHeight, false)
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render()
  })
  window.cadReady = true
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  window.cadError = message
  element('#status').textContent = `加载失败：${message}`
})
