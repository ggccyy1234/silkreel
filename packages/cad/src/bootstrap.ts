import { execFile } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { inspectEnvironment } from './environment.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const OCP_VERSION = '7.9.3.1.1'
const HELP = `Usage: npm run cad:bootstrap -- [--python PATH] [--out DIR] [options]

Installs npm dependencies, OpenCascade/Pillow and Chromium when needed, then
writes environment.json. KiCad 10 remains mandatory. On Windows,
--install-kicad attempts installation through winget.

  --skip-deps     Do not run npm ci when node_modules is absent
  --skip-browser  Do not install Chromium
  --install-kicad Install KiCad through winget on Windows
  --json          Print the final environment report
`

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

async function execute(command: string, args: string[]): Promise<void> {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  const child = execFile(command, args, { cwd: root, windowsHide: true })
  child.stdout?.pipe(process.stdout)
  child.stderr?.pipe(process.stderr)
  await new Promise<void>((resolve, reject) => child.once('error', reject).once('close', code => {
    if (code === 0) resolve(); else reject(new Error(`${command} exited ${code}`))
  }))
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    python: { type: 'string' }, out: { type: 'string' }, 'skip-deps': { type: 'boolean' },
    'skip-browser': { type: 'boolean' }, 'install-kicad': { type: 'boolean' }, json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  } })
  if (values.help) {
    console.log(HELP)
    return
  }
  let before = await inspectEnvironment({ python: values.python })
  if (!before.required.kiCad) {
    if (values['install-kicad'] && process.platform === 'win32') {
      await execute('winget.exe', ['install', '--id', 'KiCad.KiCad', '-e', '--accept-package-agreements', '--accept-source-agreements'])
      before = await inspectEnvironment({ python: values.python })
    }
    if (!before.required.kiCad) throw new Error('KiCad 10 is mandatory. Install it, then rerun cad:bootstrap. Set KICAD_CLI if it is in a custom location.')
  }
  if (!before.required.pcbnew) throw new Error(`KiCad exists but pcbnew Python is unavailable. Set KICAD_PYTHON to: ${before.kiCad.path ?? '<KiCad>/bin/python.exe'}`)
  if (!values['skip-deps'] && !await exists(path.join(root, 'node_modules'))) await execute('npm', ['ci'])
  const python = values.python ?? before.pcbnew.path
  if (!python) throw new Error('No Python interpreter with pcbnew was found')
  const venv = path.join(root, '.venv-cad')
  const venvPython = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  if (!await exists(venvPython)) await execute(python, ['-m', 'venv', venv])
  await execute(venvPython, ['-m', 'pip', 'install', `cadquery-ocp-novtk==${OCP_VERSION}`, 'Pillow==12.0.0',
    '--cache-dir', path.join(root, '.pip-cache'), '--disable-pip-version-check'])
  if (!values['skip-browser'] && !before.required.browser) await execute('npx', ['playwright', 'install', 'chromium'])
  const report = await inspectEnvironment({ python: venvPython })
  const out = path.resolve(values.out ?? path.join(root, 'exports', 'environment'))
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'environment.json'), JSON.stringify(report, null, 2))
  if (values.json) console.log(JSON.stringify(report, null, 2))
  else console.log(`Bootstrap complete. Ready: ${report.ready}\nEnvironment report: ${path.join(out, 'environment.json')}`)
  if (!report.ready) {
    for (const command of report.fixCommands) console.log(`Remaining: ${command}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
