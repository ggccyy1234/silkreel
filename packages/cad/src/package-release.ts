import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'
import { build } from 'esbuild'
import { repoRoot } from './native.js'
import { sha256 } from './audit.js'

interface LockEntry {
  version?: string; dev?: boolean; devOptional?: boolean
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>
  [key: string]: unknown
}
interface Lock { packages: Record<string, LockEntry> }
const run = promisify(execFile)

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'exports/releases/candidate' } } })
  const meta = JSON.parse(await readFile(path.join(repoRoot, 'packages/cad/package.json'), 'utf8')) as { version: string }
  const name = `silkreel-cad-${meta.version}-win-x64`
  const out = path.resolve(values.out), target = path.join(out, name)
  // Never overwrite an existing release or verification directory.
  try { await access(out); throw new Error(`Output already exists: ${out}. Choose a new --out directory.`) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This qualified release package targets Windows x64 only')
  await mkdir(target, { recursive: true })
  const copy = async (file: string): Promise<void> => {
    const dest = path.join(target, file)
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(path.join(repoRoot, file), dest)
  }
  // Explicit payload allowlist: never enumerate the workspace for artifacts.
  for (const file of ['README.md', 'AGENTS.md', 'UPSTREAM_README.md', 'LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md',
    `releases/v${meta.version}.md`, 'packages/cad/README.md',
    'packages/cad/scripts/manufacturing_layers.py', 'packages/cad/scripts/step_to_glb.py', 'packages/cad/scripts/review_video.py',
    'packages/cad/src/viewer.ts', 'packages/cad/src/types.ts', 'packages/cad/src/manufacturing.ts',
    'packages/cad/src/manufacturing-scene.ts', 'packages/cad/src/manufacturing-plan.ts',
    'fixtures/cad/colored-assembly.step', 'fixtures/cad/assembly.kicad_pcb']) await copy(file)
  const entries = ['cli', 'setup', 'smoke', 'manufacturing-review', 'generate-test-boards']
  for (const entry of entries) await build({ entryPoints: [path.join(repoRoot, `packages/cad/src/${entry}.ts`)],
    outfile: path.join(target, `packages/cad/src/${entry}.js`), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['three', 'three/*', 'playwright', 'esbuild', '@remotion/*'], legalComments: 'eof' })
  const original = JSON.parse(await readFile(path.join(repoRoot, 'package-lock.json'), 'utf8')) as Lock
  const dependencies: Record<string, string> = {}
  for (const dep of ['three', 'playwright', 'esbuild', '@remotion/compositor-win32-x64-msvc']) {
    const version = original.packages[`node_modules/${dep}`]?.version
    if (!version) throw new Error(`Dependency missing from source lock: ${dep}`)
    dependencies[dep] = version
  }
  const pkg = { name: 'silkreel-cad', version: meta.version, private: true, type: 'module', license: 'Apache-2.0',
    description: 'Agent-assisted source-faithful KiCad / STEP renderer; no LLM runtime',
    engines: { node: '>=22' }, os: ['win32'], cpu: ['x64'],
    repository: { type: 'git', url: 'https://github.com/ggccyy1234/silkreel.git' },
    scripts: { cad: 'node packages/cad/src/cli.js', 'cad:setup': 'node packages/cad/src/setup.js',
      'cad:stages': 'node packages/cad/src/manufacturing-review.js', 'cad:smoke': 'node packages/cad/src/smoke.js',
      'cad:fixtures': 'node packages/cad/src/generate-test-boards.js' }, dependencies }
  // Retain the exact transitive lock entries/integrities; no registry resolution
  // and no dependency on the development workspace's node_modules at runtime.
  const packages: Lock['packages'] = { '': { name: pkg.name, version: pkg.version, license: pkg.license,
    dependencies, engines: pkg.engines, os: pkg.os, cpu: pkg.cpu } }
  const visit = (dep: string): void => {
    const key = `node_modules/${dep}`
    if (packages[key]) return
    const entry = original.packages[key]
    if (!entry) throw new Error(`Non-hoisted or missing dependency ${dep}; adapt the packager before publishing`)
    const copied = { ...entry }; delete copied.dev; delete copied.devOptional
    packages[key] = copied
    for (const child of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) visit(child)
  }
  for (const dep of Object.keys(dependencies)) visit(dep)
  await writeFile(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  await writeFile(path.join(target, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n')
  const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim()
  const dirty = Boolean((await run('git', ['status', '--porcelain'], { cwd: repoRoot })).stdout.trim())
  await writeFile(path.join(target, 'BUILD.json'), JSON.stringify({ version: meta.version, sourceCommit: commit, dirty,
    target: 'win32-x64', externalRuntimes: ['Node.js', 'Python/OpenCascade/Pillow', 'KiCad', 'Chromium'],
    includesPrivateDesigns: false, includesComponentModels: false, includesInstalledDependencies: false }, null, 2))
  const hashes: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, item.name)
      if (item.isDirectory()) await walk(file)
      else hashes.push(`${sha256(await readFile(file))}  ${path.relative(target, file).replaceAll('\\', '/')}`)
    }
  }
  await walk(target)
  await writeFile(path.join(target, 'FILES.sha256'), hashes.join('\n') + '\n')
  const archive = path.join(out, `${name}.zip`)
  await run('tar.exe', ['-a', '-cf', archive, '-C', out, name], { maxBuffer: 1024 * 1024 })
  await writeFile(path.join(out, 'SHA256SUMS.txt'), `${sha256(await readFile(archive))}  ${path.basename(archive)}\n`)
  process.stdout.write(`Packaged ${hashes.length + 1} allowlisted files: ${archive}\nSource ${commit}, dirty=${dirty}\n`)
}
void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1 })
