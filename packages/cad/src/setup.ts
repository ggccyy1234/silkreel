import { execFile } from 'node:child_process'
import { parseArgs } from 'node:util'
import path from 'node:path'
import { repoRoot, OCP_VERSION } from './native.js'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { python: { type: 'string', default: process.platform === 'win32' ? 'python' : 'python3' } } })
  const venv = path.join(repoRoot, '.venv-cad')
  const run = (exe: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
    const child = execFile(exe, args, { cwd: repoRoot, windowsHide: true }, error => { if (error) reject(error instanceof Error ? error : new Error('Python setup failed')); else resolve() })
    child.stdout?.pipe(process.stdout); child.stderr?.pipe(process.stderr)
  })
  await run(values.python, ['-m', 'venv', venv])
  const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  await run(python, ['-m', 'pip', 'install', `cadquery-ocp-novtk==${OCP_VERSION}`, 'Pillow==12.0.0', '--cache-dir', path.join(repoRoot, '.pip-cache'), '--disable-pip-version-check'])
  process.stdout.write('Native STEP converter ready.\n')
}
void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1 })
