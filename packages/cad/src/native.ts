import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

const run = promisify(execFile)
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
export const OCP_VERSION = '7.9.3.1.1'
export async function nativePython(explicit?: string): Promise<{ python: string; version: string }> {
  const candidates = [explicit, process.env.CAD_PYTHON,
    path.join(repoRoot, '.venv-cad', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'), 'python3', 'python']
  for (const python of candidates) {
    if (!python) continue
    try {
      const { stdout } = await run(python, ['-c', 'import OCP; import importlib.metadata; print(importlib.metadata.version("cadquery-ocp-novtk"))'])
      return { python, version: `cadquery-ocp-novtk ${stdout.trim()}` }
    } catch (error) {
      if (explicit || process.env.CAD_PYTHON) throw new Error(`Configured CAD Python cannot import OCP: ${String(error)}`)
    }
  }
  throw new Error('Native OpenCascade is required for STEP. Run: npm run cad:setup -- --python /path/to/python (Python 3.10–3.13). PCB input only needs KiCad.')
}

export interface NativeReport {
  converter: string
  definitions: number
  definitionFaces: number
  definitionTriangles: number
  instanceTriangles: number
  failedFaces: string[]
  cadBoundsMm: { min: number[]; max: number[]; size: number[] }
}

export async function convertStep(python: string, input: string, output: string, deflectionMm: number): Promise<NativeReport> {
  const script = fileURLToPath(new URL('../scripts/step_to_glb.py', import.meta.url))
  const { stdout, stderr } = await run(python, [script, input, output, '--deflection', String(deflectionMm)], { maxBuffer: 16 * 1024 * 1024 })
  await writeFile(output.replace(/\.glb$/, '.conversion.log'), `${stdout}\n${stderr}`)
  const report = JSON.parse(await readFile(output.replace(/\.glb$/, '.occt.json'), 'utf8')) as NativeReport
  if (report.failedFaces.length || !report.definitionTriangles) throw new Error('Native STEP conversion reported incomplete triangulation')
  return report
}
