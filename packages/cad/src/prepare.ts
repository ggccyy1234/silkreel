import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { auditBoard, sha256 } from './audit.js'
import { geometryInfo, glbSceneMm, vrmlScene, writeGlb } from './geometry.js'
import { convertStep, nativePython } from './native.js'
import type { NativeReport } from './native.js'
import type { Audit, Manifest } from './types.js'

const run = promisify(execFile)
export const CONVERSION_VERSION = 'cad-v3.0.0'
export interface PrepareOptions {
  input: string
  out: string
  kicad?: string | undefined
  python?: string | undefined
  variables?: Record<string, string> | undefined
  modelMap?: Record<string, string> | undefined
  deflectionMm?: number | undefined
}

export async function findKiCad(explicit?: string): Promise<string> {
  if (explicit) { await access(explicit); return path.resolve(explicit) }
  if (process.env.KICAD_CLI) return findKiCad(process.env.KICAD_CLI)
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where.exe' : 'which', ['kicad-cli'])
    const found = stdout.trim().split(/\r?\n/)[0]
    if (found) { await run(found, ['version']); return found }
  } catch { /* use installation locations */ }
  const candidates = process.platform === 'win32'
    ? ['C:', 'D:', 'E:'].flatMap(drive => ['10.0', '9.0'].map(version => `${drive}/Program Files/KiCad/${version}/bin/kicad-cli.exe`))
    : ['/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli', '/usr/bin/kicad-cli']
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* next */ }
  }
  throw new Error('KiCad CLI not found. Install KiCad 9/10 or pass --kicad /absolute/path/to/kicad-cli')
}

export async function defaultVariables(kicad: string): Promise<Record<string, string>> {
  const { stdout } = await run(kicad, ['version'])
  const major = stdout.match(/\b(\d+)\.\d+/)?.[1]
  if (!major) throw new Error(`Could not read KiCad version: ${stdout}`)
  const vars: Record<string, string> = {}
  const standardCandidates = [path.resolve(path.dirname(kicad), '../share/kicad/3dmodels'),
    '/usr/share/kicad/3dmodels', '/Library/Application Support/kicad/3dmodels']
  for (const standard of standardCandidates) {
    try { await access(standard); vars[`KICAD${major}_3DMODEL_DIR`] = standard; break } catch { /* next */ }
  }
  const documents = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Documents') : ''
  const thirdParty = path.join(documents, 'KiCad', `${major}.0`, '3rdparty')
  if (documents) {
    try { await access(thirdParty); vars[`KICAD${major}_3RD_PARTY`] = thirdParty } catch { /* no package manager models */ }
  }
  const config = process.env.KICAD_CONFIG_HOME
    ?? (process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'kicad') : process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'kicad') : process.env.HOME ? path.join(process.env.HOME, '.config/kicad') : '')
  if (config) {
    try {
      const json = JSON.parse(await readFile(path.join(config, `${major}.0`, 'kicad_common.json'), 'utf8')) as { environment?: { vars?: Record<string, string> | null } }
      for (const [key, value] of Object.entries(json.environment?.vars ?? {})) if (typeof value === 'string') vars[key] = value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  // Respect explicitly configured environment values over discovered defaults.
  for (const key of Object.keys(vars)) if (process.env[key]) vars[key] = process.env[key]
  return vars
}

export async function auditInput(options: PrepareOptions): Promise<{ audit: Audit; stagedSource: string; kicad: string }> {
  const kicad = await findKiCad(options.kicad)
  const variables = { ...await defaultVariables(kicad), ...options.variables }
  return { ...await auditBoard(options.input, variables, options.modelMap), kicad }
}

export function requireComplete(audit: Audit): void {
  if (!audit.missing.length) return
  throw new Error(`Missing ${audit.missing.length} visible model reference(s). Rendering stopped; no substitutes were generated.\n` +
    audit.missing.map(m => `  ${m.ref}: ${m.source}`).join('\n') + '\nProvide --define NAME=directory or --model-map mapping.json. See audit.json.')
}

export async function runKiCad(kicad: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await run(kicad, args, { maxBuffer: 16 * 1024 * 1024 })
  // wxWidgets may warn about its preferences registry in a restricted Windows
  // process. It does not affect the model export. Other failures must surface.
  const log = `${stdout}\n${stderr}`
  const errors = log.split(/\r?\n/).filter(line => /error|warn|fail|not found|unable|cannot|could not|missing|unsupported/i.test(line)
    && !/registry key.*(?:HKCU\\Software\\kicad-cli)/i.test(line))
  if (errors.length) throw new Error(`KiCad reported an incomplete/failed conversion:\n${errors.join('\n')}`)
  return log
}

export async function prepare(options: PrepareOptions): Promise<Manifest> {
  const input = path.resolve(options.input), out = path.resolve(options.out)
  await mkdir(out, { recursive: true })
  const ext = path.extname(input).toLowerCase()
  if (!['.step', '.stp', '.kicad_pcb'].includes(ext)) throw new Error('Input must be .kicad_pcb, .step or .stp')
  const deflectionMm = options.deflectionMm ?? 0.02
  if (!(deflectionMm > 0 && deflectionMm <= 1)) throw new Error('STEP deflection must be > 0 and <= 1 mm')
  let audit: Audit | null = null, stagedSource = '', kicad = '', converterVersion = '', python = ''
  if (ext === '.kicad_pcb') {
    const result = await auditInput(options)
    audit = result.audit; stagedSource = result.stagedSource; kicad = result.kicad
    await writeFile(path.join(out, 'audit.json'), JSON.stringify(audit, null, 2))
    requireComplete(audit)
    converterVersion = (await run(kicad, ['version'])).stdout.trim()
  } else {
    const native = await nativePython(options.python)
    python = native.python; converterVersion = native.version
  }
  const inputSha256 = audit?.sha256 ?? sha256(await readFile(input))
  const key = sha256(JSON.stringify({ version: CONVERSION_VERSION, inputSha256, converterVersion, deflectionMm, models: audit?.models }))
  const cache = path.join(out, '.cad-cache', key)
  await mkdir(cache, { recursive: true })
  const modelFile = path.join(cache, 'model.glb'), manifestFile = path.join(cache, 'manifest.json')
  let manifest: Manifest | undefined
  try {
    const cached = JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest
    if (cached.modelSha256 === sha256(await readFile(modelFile))) manifest = cached
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!manifest) {
    let scene, nativeReport: NativeReport | undefined
    if (audit) {
      const staged = path.join(cache, 'source.kicad_pcb'), wrl = path.join(cache, 'source.wrl')
      await writeFile(staged, stagedSource)
      const log = await runKiCad(kicad, ['pcb', 'export', 'vrml', '--force', '--units', 'mm', '-o', wrl, staged])
      await writeFile(path.join(cache, 'kicad-export.log'), log)
      scene = vrmlScene(await readFile(wrl, 'utf8'))
      await writeGlb(scene, modelFile)
    } else {
      nativeReport = await convertStep(python, input, modelFile, deflectionMm)
      scene = await glbSceneMm(modelFile)
    }
    const geometry = geometryInfo(scene)
    if (nativeReport && geometry.triangles !== nativeReport.instanceTriangles) {
      throw new Error(`STEP export lost triangles: source ${nativeReport.instanceTriangles}, GLB ${geometry.triangles}`)
    }
    manifest = { schema: 1, input, inputSha256, converter: audit ? 'KiCad VRML → glTF (Three.js)' : 'OpenCascade STEP → glTF',
      converterVersion, model: 'model.glb', modelSha256: sha256(await readFile(modelFile)), modelUnits: 'meter',
      sourceKind: audit ? 'pcb' : 'step', tessellationMm: audit ? null : deflectionMm,
      geometry, audit, ...(nativeReport ? { nativeReport } : {}), notes: [
        'Geometry, assembly locations and colors come exclusively from the input CAD data. No inferred component bodies or model-name substitutions.',
        'STEP surfaces are tessellated; requested linear deflection is a meshing setting, not a certified geometric error bound.',
        'CAD colors/opacity are retained. Lighting and glTF surface response are presentation settings, not measured physical materials.',
        ...(audit ? [`${audit.withoutModels.length} footprint(s) declare no visible model; no body was invented for them.`] : [
          'An exported STEP contains only what its author exported. PCB traces, mask, silk and components absent from it cannot be reconstructed.',
          'Unassigned STEP surface appearances use the OpenCascade writer default; no physical material was inferred.'
        ])
      ] }
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
  }
  await copyFile(modelFile, path.join(out, 'model.glb'))
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}
