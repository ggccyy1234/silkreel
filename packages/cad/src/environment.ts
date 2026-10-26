import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { discoverJlc3d } from './jlc3d.js'

const run = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

export interface CommandCheck {
  path: string | null
  version: string | null
  error: string | null
}

export interface EnvironmentReport {
  schema: 1
  platform: string
  arch: string
  node: string
  installRoot: string
  ready: boolean
  required: {
    node: boolean
    kiCad: boolean
    pcbnew: boolean
    openCascade: boolean
    browser: boolean
    ffmpeg: boolean
  }
  kiCad: CommandCheck
  pcbnew: CommandCheck
  openCascade: CommandCheck
  browser: CommandCheck
  ffmpeg: CommandCheck
  modelDirectories: { standard: string[]; userThirdParty: string[] }
  jlc: Awaited<ReturnType<typeof discoverJlc3d>>
  fixCommands: string[]
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true } catch { return false }
}

async function commandVersion(command: string, args = ['--version']): Promise<CommandCheck> {
  try {
    const { stdout, stderr } = await run(command, args, { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 })
    return { path: command, version: (stdout || stderr).trim().split(/\r?\n/)[0] ?? '', error: null }
  } catch (error) {
    return { path: command, version: null, error: error instanceof Error ? error.message : String(error) }
  }
}

async function pathCommand(names: string[]): Promise<string | null> {
  for (const name of names) {
    try {
      const { stdout } = await run(process.platform === 'win32' ? 'where.exe' : 'which', [name], { windowsHide: true })
      const found = stdout.trim().split(/\r?\n/)[0]
      if (found && await exists(found)) return found
    } catch { /* next */ }
  }
  return null
}

async function firstExisting(candidates: (string | null | undefined)[]): Promise<string | null> {
  for (const candidate of candidates) if (candidate && await exists(candidate)) return path.resolve(candidate)
  return null
}

async function checkKiCad(): Promise<{ cli: CommandCheck; python: CommandCheck; major: string | null }> {
  const command = process.env.KICAD_CLI || await pathCommand(['kicad-cli', 'kicad-cli.exe'])
  const candidates = [command, 'C:/Program Files/KiCad/10.0/bin/kicad-cli.exe', 'D:/Program Files/KiCad/10.0/bin/kicad-cli.exe',
    'E:/Program Files/KiCad/10.0/bin/kicad-cli.exe', '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli', '/usr/bin/kicad-cli']
  const cliPath = await firstExisting(candidates) ?? command
  if (!cliPath) return {
    cli: { path: null, version: null, error: 'kicad-cli not found' },
    python: { path: null, version: null, error: 'KiCad installation not found' }, major: null
  }
  const cli = await commandVersion(cliPath, ['version'])
  const major = cli.version?.match(/\b(\d+)\.\d+/)?.[1] ?? null
  const pythonPath = process.env.KICAD_PYTHON || await firstExisting([
    path.join(path.dirname(cliPath), process.platform === 'win32' ? 'python.exe' : 'python3'),
    path.join(path.dirname(cliPath), 'python3')
  ])
  const python = pythonPath
    ? await commandVersion(pythonPath, ['-c', 'import pcbnew; print(pcbnew.GetBuildVersion())'])
    : { path: null, version: null, error: 'KiCad Python not found' }
  return { cli, python, major }
}

async function checkPythonImport(explicit: string | undefined, moduleName: string, versionCode: string): Promise<CommandCheck> {
  const candidates = [explicit, process.env.CAD_PYTHON,
    path.join(repoRoot, '.venv-cad', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
    await pathCommand(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'])]
  for (const candidate of candidates) {
    if (!candidate || !await exists(candidate)) continue
    try {
      await run(candidate, ['-c', `import ${moduleName}`], { timeout: 20000, windowsHide: true })
      const version = await commandVersion(candidate, ['-c', versionCode])
      return { ...version, path: path.resolve(candidate), error: null }
    } catch { /* next */ }
  }
  return { path: null, version: null, error: `${moduleName} unavailable` }
}

async function checkBrowser(explicit?: string): Promise<CommandCheck> {
  const found = await firstExisting([explicit, process.env.CAD_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'])
  return found ? commandVersion(found) : { path: null, version: null, error: 'Chromium browser not found' }
}

async function checkFfmpeg(explicit?: string): Promise<CommandCheck> {
  const platformPackage = `@remotion/compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''}`
  const bundled = path.join(repoRoot, 'node_modules', platformPackage, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  const found = await firstExisting([explicit, process.env.CAD_FFMPEG, bundled, await pathCommand(['ffmpeg'])])
  return found ? commandVersion(found, ['-version']) : { path: null, version: null, error: 'FFmpeg not found' }
}

export async function inspectEnvironment(options: { python?: string | undefined; browser?: string | undefined; ffmpeg?: string | undefined } = {}): Promise<EnvironmentReport> {
  const [kiCad, openCascade, browser, ffmpeg, jlc] = await Promise.all([
    checkKiCad(),
    checkPythonImport(options.python, 'OCP', 'import importlib.metadata; print(importlib.metadata.version("cadquery-ocp-novtk"))'),
    checkBrowser(options.browser), checkFfmpeg(options.ffmpeg), discoverJlc3d()
  ])
  const major = kiCad.major
  const standard = major ? [
    kiCad.cli.path ? path.resolve(path.dirname(kiCad.cli.path), '../share/kicad/3dmodels') : '',
    `/usr/share/kicad/3dmodels`, '/Library/Application Support/kicad/3dmodels'
  ].filter(Boolean) : []
  const userRoot = major ? [path.join(homedir(), 'Documents', 'KiCad', `${major}.0`, '3rdparty'),
    path.join(homedir(), '.local/share/kicad', `${major}.0`, '3rdparty')] : []
  const modelDirectories = {
    standard: (await Promise.all(standard.map(async file => await exists(file) ? file : null))).filter((value): value is string => Boolean(value)),
    userThirdParty: (await Promise.all(userRoot.map(async file => await exists(file) ? file : null))).filter((value): value is string => Boolean(value))
  }
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const required = {
    node: nodeMajor >= 22, kiCad: Boolean(kiCad.cli.path && kiCad.cli.version),
    pcbnew: Boolean(kiCad.python.path && kiCad.python.version), openCascade: Boolean(openCascade.path),
    browser: Boolean(browser.path), ffmpeg: Boolean(ffmpeg.path)
  }
  const fixCommands: string[] = []
  if (!await exists(path.join(repoRoot, 'node_modules'))) fixCommands.push('npm ci')
  if (!required.kiCad) fixCommands.push('Install KiCad 10 and its standard 3D model library from https://www.kicad.org/download/')
  if (!required.openCascade) fixCommands.push('npm run cad:setup -- --python "<KiCad Python or Python 3.10-3.13>"')
  if (!required.browser) fixCommands.push('npx playwright install chromium')
  return {
    schema: 1, platform: process.platform, arch: process.arch, node: process.versions.node,
    installRoot: repoRoot, ready: Object.values(required).every(Boolean), required,
    kiCad: kiCad.cli, pcbnew: kiCad.python, openCascade, browser, ffmpeg,
    modelDirectories, jlc, fixCommands
  }
}
