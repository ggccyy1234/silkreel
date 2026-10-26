import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { auditBoard, sha256 } from './audit.js'
import { auditInput } from './prepare.js'
import type { PrepareOptions } from './prepare.js'
import { nativePython, convertStep } from './native.js'
import { downloadJlcModel } from './jlc3d.js'
import type { DownloadedJlcModel } from './jlc3d.js'
import type { Audit, FootprintIdentity } from './types.js'

export interface ModelPlacement {
  path: string
  offset: [number, number, number]
  scale: [number, number, number]
  rotate: [number, number, number]
}

export interface RepairRecord {
  reference: string
  kind: 'missing-path' | 'without-model'
  query: string
  package: string | null
  model: DownloadedJlcModel
  placement: ModelPlacement | null
  validation: { sizeMm: [number, number, number]; triangles: number; glb: string }
}

export interface RepairOptions extends PrepareOptions {
  api?: string | undefined
  proxy?: string | undefined
  cacheDir?: string | undefined
  packageOverrides?: Record<string, string> | undefined
}

export interface RepairResult {
  sourcePcb: string
  stagedPcb: string
  repaired: boolean
  modelMap: Record<string, string>
  modelMapFile: string | null
  reportFile: string | null
  records: RepairRecord[]
  skipped: { reference: string; reason: string }[]
  initialAudit: Audit
  finalAudit: Audit
}

const listNumbers = (values: number[]): string => values.map(value => {
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? '0' : String(rounded)
}).join(' ')

function angle(value: number): number {
  return ((value % 360) + 360) % 360
}

function exactQuery(footprint: FootprintIdentity): string | null {
  if (footprint.lcsc && /^C\d+$/i.test(footprint.lcsc)) return footprint.lcsc.toUpperCase()
  if (footprint.mpn) return footprint.mpn
  if (footprint.supplierPart) return footprint.supplierPart
  const value = footprint.value?.trim()
  if (!value || value.length < 5) return null
  if (/^\d+(?:\.\d+)?\s*(?:R|K|M|G|U|N|P|F|H|OHM|Ω)?$/i.test(value)) return null
  if (!/[A-Z]/i.test(value) || !/\d/.test(value)) return null
  return value
}

function footprintPackage(footprint: FootprintIdentity): string | null {
  return footprint.package?.trim() || null
}

function placementFromJlc(model: DownloadedJlcModel, sizeMm: [number, number, number]): ModelPlacement {
  const transform = model.transform
  if (!transform) throw new Error(`${model.query}: JLC has no 3D Model Transform; placement cannot be established`)
  const desired = transform.sizeMil.map(value => value * 0.0254) as [number, number, number]
  const scale = desired.map((target, index) => {
    if (target <= 0.0001) return 1
    const actual = sizeMm[index] ?? 0
    if (!(actual > 0)) throw new Error(`${model.query}: STEP has no measurable axis ${index}`)
    const value = target / actual
    if (value < 0.2 || value > 5) throw new Error(`${model.query}: implausible JLC scale ${value.toFixed(4)} on axis ${index}`)
    return Math.round(value * 1e6) / 1e6
  }) as [number, number, number]
  const [ox, oy, oz] = transform.offsetMil
  const [rx, ry, rz] = transform.rotationEasyEda
  // EasyEDA stores offsets in mil and board Y opposite to KiCad model Y. The
  // rotation convention matches the established easyeda2kicad conversion.
  return {
    path: path.resolve(model.file),
    offset: [ox * 0.0254, -oy * 0.0254, oz * 0.0254],
    scale,
    rotate: [angle(-rx), angle(-ry), angle(-rz)]
  }
}

interface FootprintSpan { start: number; close: number }

export function footprintSpans(source: string): FootprintSpan[] {
  const spans: FootprintSpan[] = []
  const frames: { start: number; name?: string | undefined; parent?: string | undefined }[] = []
  for (const token of source.matchAll(/\(|\)|"(?:\\[\s\S]|[^"\\])*"|[^\s()"]+/g)) {
    const raw = token[0]
    if (raw === '(') {
      frames.push({ start: token.index, parent: frames.at(-1)?.name })
      continue
    }
    if (raw === ')') {
      const frame = frames.pop()
      if (frame && (frame.name === 'footprint' || frame.name === 'module') && frame.parent === 'kicad_pcb') {
        spans.push({ start: frame.start, close: token.index })
      }
      continue
    }
    const frame = frames.at(-1)
    if (frame && frame.name === undefined) frame.name = raw
  }
  return spans
}

export function injectModelDeclarations(source: string, footprints: FootprintIdentity[], additions: Record<string, ModelPlacement>): string {
  const spans = footprintSpans(source)
  if (spans.length !== footprints.length) {
    throw new Error(`PCB footprint scan mismatch: ${spans.length} source spans vs ${footprints.length} audited footprints`)
  }
  const edits: { at: number; text: string }[] = []
  for (const [index, footprint] of footprints.entries()) {
    const placement = additions[footprint.reference]
    if (!placement) continue
    const span = spans[index]
    if (!span) throw new Error(`Missing source span for ${footprint.reference}`)
    const escaped = placement.path.replace(/\\/g, '/').replace(/"/g, '\\"')
    edits.push({ at: span.close, text:
      `\n    (model "${escaped}"\n`
      + `      (offset (xyz ${listNumbers(placement.offset)}))\n`
      + `      (scale (xyz ${listNumbers(placement.scale)}))\n`
      + `      (rotate (xyz ${listNumbers(placement.rotate)})))` })
  }
  edits.sort((a, b) => b.at - a.at)
  let result = source
  for (const edit of edits) result = result.slice(0, edit.at) + edit.text + result.slice(edit.at)
  return result
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

export async function repairBoardModels(options: RepairOptions): Promise<RepairResult> {
  const sourcePcb = path.resolve(options.input)
  const initial = await auditInput(options)
  const initialAudit = initial.audit
  const identity = new Map(initialAudit.footprints.map(value => [value.reference, value]))
  const modelMap: Record<string, string> = {}
  for (const model of initialAudit.models) {
    if (model.resolved) modelMap[model.source] = path.resolve(model.resolved)
  }
  const records: RepairRecord[] = []
  const skipped: { reference: string; reason: string }[] = []
  const additions: Record<string, ModelPlacement> = {}
  const failures: string[] = []
  const output = path.resolve(options.out)
  const modelDir = path.join(output, 'models')
  const cacheDir = path.resolve(options.cacheDir ?? path.join(output, '.jlc-cache'))
  let pythonPromise: Promise<Awaited<ReturnType<typeof nativePython>>> | undefined
  const python = (): Promise<Awaited<ReturnType<typeof nativePython>>> => {
    pythonPromise ??= nativePython(options.python)
    return pythonPromise
  }
  const downloads = new Map<string, Promise<DownloadedJlcModel>>()
  const measurements = new Map<string, Promise<{ sizeMm: [number, number, number]; triangles: number; glb: string }>>()

  const download = (query: string, packageName: string | null): Promise<DownloadedJlcModel> => {
    const key = `${query.toLowerCase()}|${packageName ?? ''}`
    let pending = downloads.get(key)
    if (!pending) {
      pending = downloadJlcModel(query, modelDir, options.api, true, packageName ?? undefined, cacheDir, options.proxy)
      downloads.set(key, pending)
    }
    return pending
  }
  const resolveDownload = async (query: string, packageName: string | null, explicit: boolean): Promise<DownloadedJlcModel> => {
    try { return await download(query, packageName) } catch (error) {
      if (packageName && !explicit) return await download(query, null)
      throw error
    }
  }
  const measure = (model: DownloadedJlcModel): Promise<{ sizeMm: [number, number, number]; triangles: number; glb: string }> => {
    let pending = measurements.get(model.file)
    if (!pending) {
      const glb = path.join(output, '.model-validation', `${model.lcsc}_${model.modelUuid}.glb`)
      pending = (async () => {
        await mkdir(path.dirname(glb), { recursive: true })
        const report = await convertStep((await python()).python, model.file, glb, options.deflectionMm ?? 0.02)
        const size = report.cadBoundsMm.size
        if (size.length !== 3 || size.some(value => !Number.isFinite(value) || value <= 0)) {
          throw new Error(`${model.query}: STEP has invalid bounds ${JSON.stringify(size)}`)
        }
        return { sizeMm: size as [number, number, number], triangles: report.instanceTriangles, glb }
      })()
      measurements.set(model.file, pending)
    }
    return pending
  }

  const missingByRef = new Map<string, typeof initialAudit.missing>()
  for (const model of initialAudit.missing) {
    const current = missingByRef.get(model.ref) ?? []
    current.push(model)
    missingByRef.set(model.ref, current)
  }

  for (const [reference, missing] of missingByRef) {
    const footprint = identity.get(reference)
    const query = footprint ? exactQuery(footprint) : null
    if (!footprint || !query) {
      failures.push(`${reference}: missing model path, but PCB has no exact MPN/LCSC identity`)
      continue
    }
    try {
      const packageOverride = options.packageOverrides?.[reference]
      const packageName = packageOverride ?? footprintPackage(footprint)
      const model = await resolveDownload(query, packageName, Boolean(packageOverride))
      const validation = await measure(model)
      for (const declaration of missing) modelMap[declaration.source] = model.file
      records.push({ reference, kind: 'missing-path', query, package: packageName, model, placement: null, validation })
    } catch (error) { failures.push(`${reference}: ${error instanceof Error ? error.message : String(error)}`) }
  }

  for (const reference of initialAudit.withoutModels) {
    const footprint = identity.get(reference)
    if (!footprint) continue
    if (footprint.npthOnly || footprint.padCount === 0) {
      skipped.push({ reference, reason: footprint.padCount === 0
        ? 'footprint has no electrical pads' : 'mechanical footprint with only non-plated holes' })
      continue
    }
    const query = exactQuery(footprint)
    if (!query) {
      failures.push(`${reference}: no visible model and no exact MPN/LCSC identity`)
      continue
    }
    try {
      const packageOverride = options.packageOverrides?.[reference]
      const packageName = packageOverride ?? footprintPackage(footprint)
      const model = await resolveDownload(query, packageName, Boolean(packageOverride))
      if (!model.transform) throw new Error('JLC model has no placement transform')
      const validation = await measure(model)
      const placement = placementFromJlc(model, validation.sizeMm)
      additions[reference] = placement
      records.push({ reference, kind: 'without-model', query, package: packageName, model, placement, validation })
    } catch (error) { failures.push(`${reference}: ${error instanceof Error ? error.message : String(error)}`) }
  }

  let stagedPcb = sourcePcb
  let repaired = false
  const stagedDir = path.join(output, 'staged')
  const modelMapFile = path.join(output, 'model-map.json')
  const reportFile = path.join(output, 'model-repair.json')
  if (failures.length === 0 && records.length > 0) {
    const source = await readFile(sourcePcb, 'utf8')
    if (Object.keys(additions).length) {
      const injected = injectModelDeclarations(source, initialAudit.footprints, additions)
      await mkdir(stagedDir, { recursive: true })
      stagedPcb = path.join(stagedDir, `${path.basename(sourcePcb, '.kicad_pcb')}.repaired.kicad_pcb`)
      await writeFile(stagedPcb, injected)
    }
    repaired = records.length > 0
    await writeFile(modelMapFile, JSON.stringify(modelMap, null, 2))
  }
  const finalAudit = failures.length ? initialAudit : (await auditBoard(stagedPcb, {}, modelMap)).audit
  if (failures.length === 0 && finalAudit.missing.length) failures.push(`Repair left ${finalAudit.missing.length} unresolved model declaration(s)`)
  const finalElectronicWithout = finalAudit.withoutModels.filter(reference => {
    const footprint = identity.get(reference)
    return !(footprint?.npthOnly || footprint?.padCount === 0)
  })
  if (failures.length === 0 && finalElectronicWithout.length) failures.push(`Repair left electrical footprints without models: ${finalElectronicWithout.join(', ')}`)
  const report = {
    schema: 1,
    sourcePcb,
    sourceSha256: initialAudit.sha256,
    stagedPcb,
    stagedSha256: await exists(stagedPcb) ? sha256(await readFile(stagedPcb)) : initialAudit.sha256,
    repaired,
    sourceModified: false,
    symbolLibrariesModified: false,
    sharedFootprintLibrariesModified: false,
    modelMap,
    records,
    skipped,
    failures,
    initial: { missing: initialAudit.missing, withoutModels: initialAudit.withoutModels },
    final: { missing: finalAudit.missing, withoutModels: finalAudit.withoutModels }
  }
  if (repaired || failures.length) {
    await mkdir(output, { recursive: true })
    await writeFile(reportFile, JSON.stringify(report, null, 2))
    await writeFile(modelMapFile, JSON.stringify(modelMap, null, 2))
  }
  if (failures.length) throw new Error(`Automatic model repair stopped:\n${failures.map(value => `  ${value}`).join('\n')}\nSee ${reportFile}`)
  return { sourcePcb, stagedPcb, repaired, modelMap, modelMapFile: await exists(modelMapFile) ? modelMapFile : null,
    reportFile: await exists(reportFile) ? reportFile : null, records, skipped, initialAudit, finalAudit }
}
