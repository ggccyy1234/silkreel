import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSExpr } from '@silk-reel/ingest'
import type { SExprNode } from '@silk-reel/ingest'
import { sha256 } from './audit.js'
import { findKiCad, runKiCad } from './prepare.js'
import type { Manifest } from './types.js'
import { manufacturingPlan } from './manufacturing-plan.js'
import { requireQualifiedStack } from './compatibility.js'

export interface Contour { outer: number[][]; holes: number[][][] }
export interface StackLayer { name: string; type: string; thickness: number; z: number }
export interface ManufacturingData {
  schema: 1
  title?: string
  input: string
  sha256: string
  engine: string
  curveErrorMm: number
  outline: Contour[]
  drilled: Contour[]
  layers: Record<string, Contour[]>
  pasteSvg: Record<string, string>
  footprints: Record<string, { side: 'top' | 'bottom'; mount?: string; position: number[] }>
  stack: StackLayer[]
  nodes: Record<string, { kind: string; ref?: string }>
  missingInStep: string[]
  duration: number
}
const lists = (n: SExprNode[], key: string): SExprNode[][] => n.filter((v): v is SExprNode[] => Array.isArray(v) && v[0] === key)
const first = (n: SExprNode[], key: string): SExprNode[] => lists(n, key)[0] ?? []

export function readStack(source: string): StackLayer[] {
  const root = parseSExpr(source, 'manufacturing PCB')
  const stack = first(first(root, 'setup'), 'stackup')
  const layers = lists(stack, 'layer').filter(l => ['copper', 'core', 'prepreg'].includes(String(first(l, 'type')[1])))
    .map(l => ({ name: String(l[1]), type: String(first(l, 'type')[1]), thickness: Number(first(l, 'thickness')[1]), z: 0 }))
  if (layers.length < 3 || layers.some(l => !Number.isFinite(l.thickness) || !(l.thickness > 0))) throw new Error('Manufacturing needs explicit copper/dielectric stackup thicknesses')
  const total = layers.reduce((sum, l) => sum + l.thickness, 0)
  // KiCad STEP origin is the lower laminate face, below B.Cu. F.Cu is above
  // the upper laminate face. Interior copper is contained within that span.
  const last = layers.at(-1)
  if (!last) throw new Error('Empty stackup')
  let z = total - last.thickness
  for (const l of layers) { z -= l.thickness; l.z = z }
  return layers
}

export async function prepareManufacturing(out: string, pcb: string, manifest: Manifest, kicad?: string, explicitPython?: string, title?: string, allowIncomplete = false): Promise<void> {
  if (manifest.sourceKind !== 'step') throw new Error('Manufacturing currently requires the released assembly STEP plus its matching --pcb')
  const source = await readFile(pcb, 'utf8'), stack = readStack(source)
  requireQualifiedStack(stack)
  const cli = await findKiCad(kicad)
  const python = explicitPython ?? process.env.KICAD_PYTHON
    ?? path.join(path.dirname(cli), process.platform === 'win32' ? 'python.exe' : 'python3')
  const target = path.join(out, 'manufacturing.json')
  const script = fileURLToPath(new URL('../scripts/manufacturing_layers.py', import.meta.url))
  const { stdout, stderr } = await promisify(execFile)(python, [script, pcb, target], { maxBuffer: 8 * 1024 * 1024 })
  await writeFile(path.join(out, 'manufacturing-extraction.log'), `${stdout}\n${stderr}`)
  const data = JSON.parse(await readFile(target, 'utf8')) as ManufacturingData
  if (data.sha256 !== sha256(source)) throw new Error('PCB changed during manufacturing extraction')
  const pasteDir = path.join(out, 'paste-source')
  await runKiCad(cli, ['pcb', 'export', 'svg', '--layers', 'F.Paste,B.Paste', '--exclude-drawing-sheet',
    '--page-size-mode', '1', '--drill-shape-opt', '0', '--scale', '1', '--mode-multi', '-o', pasteDir, pcb])
  data.pasteSvg = {}
  for (const layer of ['F.Paste', 'B.Paste']) data.pasteSvg[layer] = await readFile(path.join(pasteDir,
    `${path.basename(pcb, '.kicad_pcb')}-${layer.replace('.', '_')}.svg`), 'utf8')
  const root = parseSExpr(source, pcb)
  const footprintNodes = lists(root, 'footprint')
  const bytes = await readFile(path.join(out, manifest.model))
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
    nodes: { name?: string; mesh?: number; translation?: number[] }[]; meshes: { name?: string }[]
  }
  const nodes: ManufacturingData['nodes'] = {}
  const found = new Set<string>()
  for (const [i, node] of json.nodes.entries()) {
    if (node.name && data.footprints[node.name]) {
      nodes[String(i)] = { kind: 'component', ref: node.name }; found.add(node.name)
      const p = data.footprints[node.name]?.position
      if (node.translation && p) {
        const footprint = footprintNodes.find(f => lists(f, 'property').some(v => v[1] === 'Reference' && v[2] === node.name)) ?? []
        const angle = Number(first(footprint, 'at')[3] ?? 0) * Math.PI / 180
        const side = data.footprints[node.name]?.side === 'bottom' ? -1 : 1
        const matches = lists(footprint, 'model').some(model => {
          const offset = first(first(model, 'offset'), 'xyz')
          const x = Number(offset[1] ?? 0), y = Number(offset[2] ?? 0) * side
          return Math.hypot(Number(node.translation?.[0]) * 1000 - Number(p[0]) - Math.cos(angle) * x + Math.sin(angle) * y,
            Number(node.translation?.[1]) * 1000 - Number(p[1]) - Math.sin(angle) * x - Math.cos(angle) * y) < 0.02
        })
        if (!matches) throw new Error(`STEP / PCB component position mismatch (including declared offsets): ${node.name}`)
      }
    } else if (node.mesh !== undefined) {
      const name = json.meshes[node.mesh]?.name ?? ''
      const kind = /_(copper|pad|via|silkscreen|soldermask|PCB)$/.exec(name)?.[1]
      if (kind) nodes[String(i)] = { kind }
    }
  }
  if (!Object.values(nodes).some(n => n.kind === 'PCB') || found.size === 0) throw new Error('STEP lacks named KiCad board/component assembly; refusing guessed classification')
  data.stack = stack; data.nodes = nodes; data.title = title || path.basename(pcb, '.kicad_pcb')
  data.duration = manufacturingPlan(data).duration
  data.missingInStep = lists(root, 'footprint').filter(f => lists(f, 'model').some(m => !m.includes('hide') && first(m, 'hide')[1] !== 'yes'))
    .map(f => String(lists(f, 'property').find(p => p[1] === 'Reference')?.[2] ?? '')).filter(ref => ref && !found.has(ref))
  await writeFile(target, JSON.stringify(data))
  if (data.missingInStep.length && !allowIncomplete) throw new Error(`Source STEP omits declared PCB components: ${data.missingInStep.join(', ')}. Stopped; no replacements generated. Obtain a complete native export, or explicitly approve a disclosed partial film with --allow-incomplete-step.`)
  manifest.manufacturing = { file: 'manufacturing.json', sha256: sha256(await readFile(target)), pcb: path.resolve(pcb),
    pcbSha256: data.sha256, duration: data.duration, curveErrorMm: data.curveErrorMm,
    missingInStep: data.missingInStep }
  manifest.notes.push('Manufacturing layers use KiCad polygon contours and the explicit PCB stackup; curves have a 0.005 mm polygonisation setting.',
    'Paste apertures use native KiCad SVG plots, including local paste clearance/ratio and custom drawings; PCB coordinates are retained in millimetres.',
    'Explosion distances, process sweeps, paste display thickness and reflow light are illustrative. No machine motion, paste volume, solder fillet or temperature field is inferred.',
    'Opening and closing assemblies are the unchanged source STEP. Process geometry is replaced by that assembly at the end.',
    `Declared PCB models absent from released STEP: ${data.missingInStep.join(', ') || 'none'}. No replacements generated.`)
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
}
