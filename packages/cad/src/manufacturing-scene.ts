import { Box3, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, Plane, Shape, Vector2, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { Contour, ManufacturingData } from './manufacturing.js'
import { manufacturingPlan } from './manufacturing-plan.js'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Incomplete manufacturing data')
  return value
}

export const PROCESS_STAGES = [
  [0, '成品总览', '源 CAD 装配'], [3, '旋转拆解', '源 PCB 叠层'],
  [8, '真实叠层', '读取实际厚度'],
  [10, '内层蚀刻', '从整面铜箔到源 PCB 的实际内层线路'], [14, '叠层与压合', '逐层对齐 · 芯板 / 半固化片 / 铜箔'],
  [20, '钻孔与孔金属化', '真实钻孔位置与孔径 · 显示最终孔壁几何'], [23, '外层蚀刻', '形成顶层与底层铜线路'],
  [26, '阻焊', '按源文件的真实阻焊开窗覆盖'], [29, '丝印', '原始标识与位号'],
  [31, '底面 · 锡膏印刷', 'B.Paste 实际开口'], [33, '底面 · SMT 贴装', '按 STEP 中的真实器件与装配变换落位'],
  [36, '底面 · 回流焊', '工艺光效示意 · 保留原始器件几何'], [38, '顶面 · 锡膏印刷', 'F.Paste 实际开口'],
  [40, '顶面 · SMT 贴装', '按 STEP 中的真实器件与装配变换落位'], [43, '顶面 · 回流焊', '工艺光效示意 · 保留原始器件几何'],
  [45, '装配完成', '回到未经改形的原始 STEP 装配']
] as const
export const smooth = (x: number): number => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
export function processState(progress: number, plan?: ReturnType<typeof manufacturingPlan>): { time: number; stage: number; explosion: number; elevation: number } {
  const duration = plan?.duration ?? 48, stages = plan?.stages ?? PROCESS_STAGES
  const time = Math.max(0, Math.min(duration, progress * duration))
  let stage = 0
  for (let i = 0; i < stages.length; i++) if (time >= required(stages[i])[0]) stage = i
  let elevation = 42 - 88 * smooth((time - 30) / 2) + 88 * smooth((time - 37) / 2)
  if (plan) {
    elevation = 42
    let previous = 42
    for (const p of plan.placements) {
      const target = p.side === 'top' ? 42 : -46
      elevation += (target - previous) * smooth((time - (p.paste ?? p.start) + 1) / 2)
      previous = target
    }
    elevation += (42 - previous) * smooth((time - plan.finish) / 2)
  }
  return { time, stage, explosion: smooth((time - 3) / 4) * (1 - smooth((time - 14) / 6)),
    elevation }
}

function geometry(contours: Contour[], z: number, thickness: number): ExtrudeGeometry {
  const shapes = contours.filter(c => c.outer.length >= 3).map(c => {
    const s = new Shape(c.outer.map(p => new Vector2(required(p[0]), required(p[1]))))
    s.holes = c.holes.filter(h => h.length >= 3).map(h => new Path(h.map(p => new Vector2(required(p[0]), required(p[1])))))
    return s
  })
  const g = new ExtrudeGeometry(shapes, { depth: thickness, bevelEnabled: false, steps: 1, curveSegments: 1 })
  g.translate(0, 0, z)
  return g
}

export function manufacturingScene(source: Object3D, gltf: GLTF, data: ManufacturingData, presentationCenter: Vector3): {
  group: Group; update: (progress: number, active: boolean) => { zoom: number; elevation: number }; summary: () => { translated: number; visible: number }
} {
  const plan = manufacturingPlan(data)
  const group = new Group(), native: { object: Object3D; kind: string; ref?: string; base: Vector3; side: number }[] = []
  const parts: typeof native = []
  source.traverse(object => {
    const index = gltf.parser.associations.get(object)?.nodes
    const metadata = index === undefined ? undefined : data.nodes[String(index)]
    if (!metadata) return
    const b = new Box3().setFromObject(object, true)
    const side = metadata.ref ? required(data.footprints[metadata.ref]).side === 'top' ? 1 : -1 : b.getCenter(new Vector3()).z > required(data.stack[0]).z / 2 ? 1 : -1
    const entry = { object, ...metadata, base: object.position.clone(), side }
    native.push(entry)
    if (metadata.kind === 'component') parts.push(entry)
  })
  if (parts.length === 0) throw new Error('No component nodes mapped to the manufacturing source')
  // Each instance receives its own viewing material so process clipping never
  // affects another instance or the exact assembled geometry.
  source.traverse(o => {
    if (o instanceof Mesh) {
      const mesh = o as Mesh
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone()
    }
  })
  const bounds = new Box3().setFromObject(source, true), minX = bounds.min.x - presentationCenter.x, spanX = bounds.max.x - bounds.min.x
  const halfSize = bounds.getSize(new Vector3()).multiplyScalar(0.5)
  const body = native.find(n => n.kind === 'PCB')
  if (!body) throw new Error('Missing explicitly named PCB body')
  const bodyBox = new Box3().setFromObject(body.object, true)
  const innerCount = data.stack.filter(l => l.type === 'copper').length - 2
  const columns = Math.max(1, Math.ceil(Math.sqrt(innerCount))), rows = Math.max(1, Math.ceil(innerCount / columns))
  const panelWidth = (bodyBox.max.x - bodyBox.min.x) * 1.12, panelHeight = (bodyBox.max.y - bodyBox.min.y) * 1.12
  if (Math.abs(bodyBox.min.z) > 0.001 || Math.abs(bodyBox.max.z - required(data.stack[0]).z) > 0.001) throw new Error('Released STEP body and PCB stackup thickness do not match')
  const layers = data.stack.map((l, i) => {
    const material = new MeshStandardMaterial({ color: l.type === 'copper' ? '#a9642d' : l.type === 'core' ? '#929d6e' : '#c0bc8e',
      metalness: l.type === 'copper' ? 0.35 : 0, roughness: l.type === 'copper' ? 0.5 : 0.8, side: DoubleSide })
    const contours = l.type === 'copper' ? data.layers[l.name] : data.outline
    if (!contours?.length) throw new Error(`Missing fabrication contours: ${l.name}`)
    const mesh = new Mesh(geometry(contours, l.z, l.thickness), material)
    mesh.name = l.name
    const drilled = l.type === 'copper' ? null : new Mesh(geometry(data.drilled, l.z, l.thickness), material.clone())
    const foil = l.type === 'copper' ? new Mesh(geometry(data.outline, l.z, l.thickness), material.clone()) : null
    const foilDrilled = l.type === 'copper' && (i === 0 || i === data.stack.length - 1) ? new Mesh(geometry(data.drilled, l.z, l.thickness), material.clone()) : null
    group.add(mesh)
    if (drilled) group.add(drilled)
    if (foil) group.add(foil)
    if (foilDrilled) group.add(foilDrilled)
    return { ...l, mesh, drilled, foil, foilDrilled, offset: (data.stack.length / 2 - i - 0.5) * 3.2 }
  })
  const top = required(data.stack[0]), bottom = required(data.stack[data.stack.length - 1])
  const pasteContours = (name: string): Contour[] => {
    const svg = new SVGLoader().parse(required(data.pasteSvg[name]))
    return svg.paths.flatMap(p => {
      const style = p.userData?.style as { fill?: string; stroke?: string } | undefined
      if (style?.fill === 'none' && style.stroke !== 'none') throw new Error('Stroked paste graphics need explicit polygon export')
      return SVGLoader.createShapes(p).map(s => {
        const points = s.extractPoints(64)
        return { outer: points.shape.map(v => [v.x, -v.y]), holes: points.holes.map(h => h.map(v => [v.x, -v.y])) }
      })
    })
  }
  const pastes = plan.placements.filter(p => p.paste !== undefined && p.reflow !== undefined).map(p => ({
    side: p.side === 'top' ? 1 : -1, start: required(p.paste), end: required(p.reflow),
    mesh: new Mesh(geometry(pasteContours(p.side === 'top' ? 'F.Paste' : 'B.Paste'),
      p.side === 'top' ? top.z + top.thickness + 0.016 : bottom.z - 0.056, 0.04),
    new MeshStandardMaterial({ color: '#b4bec5', metalness: 0.4, roughness: 0.65 }))
  }))
  for (const p of pastes) group.add(p.mesh)
  const overlay = document.createElement('div')
  overlay.id = 'process'; overlay.innerHTML = '<div class="eyebrow"></div><h2></h2><p></p><div class="layer-list"></div><div class="process-foot"></div><div class="process-track"><i></i></div>'
  document.body.append(overlay)
  const query = (s: string): HTMLElement => {
    const element = overlay.querySelector<HTMLElement>(s)
    if (!element) throw new Error(`Missing process element ${s}`)
    return element
  }
  const layerList = query('.layer-list')
  layerList.innerHTML = data.stack.map(l => `<div><span>${l.name.replace('dielectric ', l.type === 'core' ? '芯板 ' : '半固化片 ')}</span><b>${Math.round(l.thickness * 1000)} μm</b></div>`).join('')
  const clip = (object: Object3D, fraction: number, opposite = false, xOffset = 0): void => {
    const plane = new Plane(new Vector3(opposite ? 1 : -1, 0, 0), (opposite ? -1 : 1) * (minX + xOffset + spanX * fraction))
    object.traverse(o => {
      if (!(o instanceof Mesh)) return
      const mesh = o as Mesh
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.clippingPlanes = fraction >= 1 && !opposite ? [] : [plane]
    })
  }
  const update = (progress: number, active: boolean): { zoom: number; elevation: number } => {
    const { time: t, stage, explosion, elevation } = processState(progress, plan)
    overlay.hidden = !active
    for (const p of pastes) p.mesh.visible = active && t >= p.start && t < p.end
    // Pastes are outside group visibility; group is needed through the SMT acts.
    group.visible = active && t >= 3 && t < plan.finish
    const hero = !active || t < 3 || t >= plan.finish
    for (const n of native) {
      n.object.position.copy(n.base); n.object.visible = true; clip(n.object, 1)
      if (hero) continue
      if (['PCB', 'copper', 'pad', 'via'].includes(n.kind)) n.object.visible = t >= 26
      if (n.kind === 'via' && t >= 22.5) n.object.visible = true
      if (n.kind === 'soldermask' || n.kind === 'silkscreen') {
        const start = n.kind === 'soldermask' ? 26 : 29
        n.object.visible = t < 10 || t >= start
        n.object.position.z += n.side * 21 * (t < 10 ? explosion : 0) / 1000
        if (t >= start) clip(n.object, smooth((t - start) / (n.kind === 'soldermask' ? 2.3 : 1.5)))
      }
      if (n.kind === 'component') {
        const footprint = required(data.footprints[n.ref ?? ''])
        const placement = required(plan.placements.find(p => p.side === footprint.side && p.mount === (footprint.mount ?? 'smd')))
        const start = placement.start
        const sameGroup = parts.filter(p => p.side === n.side && (data.footprints[p.ref ?? '']?.mount ?? 'smd') === placement.mount)
        const rank = sameGroup.sort((a, b) => a.base.x - b.base.x || (a.ref ?? '').localeCompare(b.ref ?? '')).findIndex(p => p === n)
        const count = sameGroup.length
        const place = smooth((t - start - rank / count * 1.9) / 0.65)
        n.object.visible = t < 10 || t >= start + rank / count * 1.9
        n.object.position.z += n.side * (t < 10 ? 28 * explosion : 10 * (1 - place)) / 1000
      }
    }
    for (const [i, l] of layers.entries()) {
      const outer = i === 0 || i === layers.length - 1
      const assembly = smooth((t - 14 - (layers.length - 1 - i) * 0.4) / 1.35)
      const offset = t < 14 ? l.offset * explosion : l.offset * (1 - assembly)
      // During inner etching, spread the actual inner copper layers into
      // separate panels so a solid outer foil cannot hide the operation.
      const innerIndex = layers.slice(0, i + 1).filter(v => v.type === 'copper' && v !== layers[0] && v !== layers.at(-1)).length - 1
      const panels = smooth((t - 9.8) / 0.9) * (1 - smooth((t - 14) / 1.2))
      const panelX = l.type === 'copper' && !outer ? (innerIndex % columns - (columns - 1) / 2) * panelWidth * panels : 0
      const panelY = l.type === 'copper' && !outer ? (Math.floor(innerIndex / columns) - (rows - 1) / 2) * panelHeight * panels : 0
      for (const mesh of [l.mesh, l.drilled, l.foil, l.foilDrilled]) if (mesh) { mesh.position.x = panelX; mesh.position.y = panelY }
      l.mesh.position.z = offset
      l.mesh.visible = !hero && t < 26
      if (t >= 10.7 && t < 14 && (outer || l.type !== 'copper')) l.mesh.visible = false
      clip(l.mesh, 1)
      if (l.drilled) {
        l.drilled.position.z = offset
        l.drilled.visible = !hero && (t < 10 || t >= 20) && t < 26
        if (t < 10) { l.mesh.visible = false; clip(l.drilled, 1) }
        if (t >= 20) { clip(l.mesh, smooth((t - 20) / 2.4), true); clip(l.drilled, smooth((t - 20) / 2.4)) }
      }
      if (l.foil) {
        l.foil.position.z = offset
        const etch = t < 10 ? 1 : outer ? smooth((t - 23) / 2.4) : smooth((t - 10) / 3.2)
        l.foil.visible = !hero && t >= 10 && t < 26 && etch < 1
        if (outer && t >= 10.7 && t < 14) l.foil.visible = false
        clip(l.mesh, etch, false, panelX); clip(l.foil, etch, true, panelX)
        if (l.foilDrilled) {
          l.foilDrilled.position.z = offset
          l.foilDrilled.visible = !hero && t >= 20 && t < 26 && etch < 1
          if (t >= 20 && t < 23) { clip(l.foil, smooth((t - 20) / 2.4), true); clip(l.foilDrilled, smooth((t - 20) / 2.4)) }
          if (t >= 23) { l.foil.visible = false; clip(l.foilDrilled, etch, true) }
        }
      }
    }
    for (const p of pastes) {
      if (p.mesh.visible) clip(p.mesh, smooth((t - p.start) / 1.6))
      const reflowStart = p.end
      const heat = Math.sin(Math.PI * Math.max(0, Math.min(1, (t - reflowStart) / 2)))
      if (active && t >= reflowStart && t < reflowStart + 2) p.mesh.visible = true
      p.mesh.material.emissive.set('#e97e32'); p.mesh.material.emissiveIntensity = heat * 1.2
    }
    query('.eyebrow').textContent = `${data.title ?? 'PCB'}     ${String(stage + 1).padStart(2, '0')} / ${plan.stages.length}`
    query('h2').textContent = required(plan.stages[stage])[1]
    query('p').textContent = required(plan.stages[stage])[2]
    layerList.hidden = !(t >= 7 && t < 20)
    query('.process-foot').textContent = '真实 CAD 几何 · 制造过程示意' + (data.missingInStep.length ? `  /  源 STEP 未含 ${data.missingInStep.join('、')}` : '')
    query('.process-track i').style.width = `${Math.min(100, progress * 100)}%`
    // Fit the complete exploded envelope, including tall source models, rather
    // than using a fixed zoom tuned to a particular board size.
    const panels = smooth((t - 9.8) / 0.9) * (1 - smooth((t - 14) / 1.2))
    const expandedRadius = Math.hypot(halfSize.x + (columns - 1) * panelWidth * panels / 2,
      halfSize.y + (rows - 1) * panelHeight * panels / 2, halfSize.z + 28 * explosion)
    return { zoom: Math.max(1, expandedRadius / halfSize.length()), elevation }
  }
  return { group, update, summary: () => ({ translated: native.filter(n => !n.object.position.equals(n.base)).length, visible: native.filter(n => n.object.visible).length }) }
}
