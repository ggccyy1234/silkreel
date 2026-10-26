import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'

const DEFAULT_API = 'https://pro.lceda.cn/api'
const DEFAULT_MODEL_ROOT = 'https://modules.lceda.cn/qAxj6KHrDKw4blvCG8QJPs7Y/'
const DOWNLOADER_NAMES = new Set(['jlc3ddownload.py', '嘉立创3d下载器.exe'])
const run = promisify(execFile)
const HELP = `JLC3D exact STEP model helper

  npm run cad:jlc -- --doctor
  npm run cad:jlc -- STM32F103C8T6 --package LQFP-48 --out exports/cad-models
  npm run cad:jlc -- C8734 --dry-run --json

Queries may be exact MPNs or LCSC IDs. Ambiguous MPN/package matches stop and
list candidates. Use --package to disambiguate, or use the exact LCSC code.

  --lcsc VALUE       Exact LCSC ID (repeatable)
  --part VALUE       Exact manufacturer part number (repeatable)
  --package VALUE    Package filter for ambiguous MPN matches
  --out DIR          Project-local output directory (default exports/cad-models)
  --cache DIR        Cache resolved metadata and STEP files (default <out>/.jlc-cache)
  --proxy URL        HTTP proxy for JLC requests (or HTTPS_PROXY environment variable)
  --dry-run          Resolve model URL without downloading
  --overwrite        Replace an existing same-named STEP
  --json             Print a machine-readable report
  --doctor           Discover JLC3D, its config/download path and easyeda2kicad
`

export interface JlcDiscovery {
  configFile: string | null
  downloadPath: string | null
  downloaders: string[]
  easyeda2kicad: string[]
}

export interface JlcTransform {
  raw: string
  sizeMil: [number, number, number]
  rotationEasyEda: [number, number, number]
  offsetMil: [number, number, number]
}

export interface ResolvedJlcModel {
  query: string
  lcsc: string
  mpn: string
  manufacturer: string
  package: string
  title: string
  modelUuid: string
  modelFile: string
  url: string
  transform: JlcTransform | null
  attribution: { library: string; links: string[] }
  resolvedAt: string
}

export interface DownloadedJlcModel {
  query: string
  lcsc: string
  mpn: string
  manufacturer: string
  package: string
  title: string
  modelUuid: string
  source: string
  file: string
  sha256: string
  bytes: number
  transform: JlcTransform | null
  attribution: { library: string; links: string[] }
  resolvedAt: string
}

function expandHome(value: string): string {
  return value.startsWith('~/') || value.startsWith('~\\') ? path.join(homedir(), value.slice(2)) : value
}

async function isFile(file: string): Promise<boolean> {
  try { return (await access(file), true) } catch { return false }
}

export async function readJlcConfig(file: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8')
    const value = /^\s*downloadpath\s*=\s*(.+?)\s*$/im.exec(text)?.[1]
    return value ? expandHome(value.replace(/^["']|["']$/g, '')) : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function findNamedFiles(root: string, names: Set<string>, maxDepth: number, filterDirectories = true): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && names.has(entry.name.toLowerCase())) found.push(full)
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const lower = entry.name.toLowerCase()
      if (['node_modules', '.git', 'windows', 'system32', 'temp', 'cache'].includes(lower)) continue
      if (filterDirectories && depth > 0 && !/(jlc|嘉立创|kicad|easyeda)/i.test(lower)) continue
      await visit(full, depth + 1)
    }
  }
  await visit(root, 0)
  return found
}

export async function discoverJlc3d(): Promise<JlcDiscovery> {
  const home = homedir()
  const configHome = process.env.JLC3D_HOME || path.join(home, '.jlc3d')
  const configFile = path.join(configHome, 'config.ini')
  const configPath = await readJlcConfig(configFile)
  const downloaders = new Set<string>()
  const easyeda = new Set<string>()
  const explicit = process.env.JLC3D_DOWNLOADER
  if (explicit && await isFile(explicit)) downloaders.add(path.resolve(explicit))
  const roots = [
    path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'),
    process.env.ProgramFiles, process.env['ProgramFiles(x86)'], '/Applications', '/opt'
  ].filter((value): value is string => Boolean(value))
  for (const drive of ['C:', 'D:', 'E:']) roots.push(`${drive}${path.sep}Program Files`)
  const easyedaNames = new Set(['__main__.py'])
  for (const root of roots) {
    for (const file of await findNamedFiles(root, DOWNLOADER_NAMES, 4)) downloaders.add(file)
  }
  const kicadRoot = path.join(home, 'Documents', 'KiCad')
  for (const file of await findNamedFiles(kicadRoot, easyedaNames, 8, false)) {
    if (/easyeda2kicad/i.test(file)) easyeda.add(file)
  }
  return {
    configFile: await isFile(configFile) ? configFile : null,
    downloadPath: process.env.JLC3D_DOWNLOAD_PATH || configPath,
    downloaders: [...downloaders].sort(), easyeda2kicad: [...easyeda].sort()
  }
}

export function exactProduct(payload: unknown, query: string, packageName?: string): Record<string, unknown> {
  const list = (payload as { result: { productList?: unknown[] } }).result.productList
  if (!Array.isArray(list)) throw new Error('JLC search response has no productList')
  const candidates = list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  const normalized = query.toUpperCase()
  let exact = candidates.filter(item => scalar(item.code).toUpperCase() === normalized
    || scalar(item.model).toUpperCase() === normalized)
  if (packageName) {
    const wanted = packageName.toLowerCase()
    exact = exact.filter(item => scalar(item.standard).toLowerCase().includes(wanted)
      || scalar(item.packageNumber).toLowerCase() === wanted)
  }
  if (!exact.length) throw new Error(`JLC search did not return an exact product/model match for ${query}${packageName ? ` (${packageName})` : ''}`)
  if (exact.length === 1) return exact[0] as Record<string, unknown>
  const withDevice = exact.filter(item => Boolean(scalar(item.hasDevice)))
  if (withDevice.length === 1) return withDevice[0] as Record<string, unknown>
  const choices = exact.map(item => `${scalar(item.code) || '?'} / ${scalar(item.model) || '?'} / ${scalar(item.standard) || 'package unknown'}`).join('; ')
  throw new Error(`JLC model match is ambiguous for ${query}; pass --package or an exact LCSC code. Candidates: ${choices}`)
}

async function curlBytes(url: string, args: string[], proxy?: string): Promise<Buffer> {
  const commandArgs = ['--fail', '--silent', '--show-error', '--location', '--max-time', '60',
    '--user-agent', 'silkreel-cad/0.1', ...args, ...(proxy ? ['--proxy', proxy] : []), url]
  let lastError: unknown
  for (const executable of process.platform === 'win32' ? ['curl.exe', 'curl'] : ['curl']) {
    try {
      const result = await run(executable, commandArgs, { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' })
      return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
    } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('curl request failed')
}

async function requestBytes(url: string, init: RequestInit = {}, proxy?: string): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt === 0 && (proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) {
        try {
          const method = init.method ?? 'GET', body = typeof init.body === 'string' ? init.body : undefined
          const headers = new Headers(init.headers)
          return await curlBytes(url, [
            ...(method === 'GET' ? [] : ['--request', method]),
            ...(body ? ['--header', `Content-Type: ${headers.get('content-type') ?? 'application/x-www-form-urlencoded'}`, '--data-binary', body] : [])
          ], proxy ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY)
        } catch (curlError) { lastError = curlError }
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('JLC request failed')
}

async function postForm(api: string, endpoint: string, values: Record<string, string>, proxy?: string): Promise<unknown> {
  try {
    const bytes = await requestBytes(`${api}${endpoint}`, {
      method: 'POST', headers: { 'User-Agent': 'silkreel-cad/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString()
    }, proxy)
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`JLC API ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function safeModelName(lcsc: string, title: string): string {
  const printable = Array.from(`${lcsc}_${title}`, char => char.charCodeAt(0) < 32 ? '_' : char).join('')
  const clean = printable.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 120)
  return `${clean || lcsc}.step`
}

function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function parseJlcTransform(rawValue: unknown): JlcTransform | null {
  const raw = scalar(rawValue).trim()
  if (!raw) return null
  const values = raw.split(',').map(value => Number(value.trim()))
  if (values.length !== 9 || values.some(value => !Number.isFinite(value))) {
    throw new Error(`Invalid JLC 3D Model Transform: ${raw}`)
  }
  return {
    raw,
    sizeMil: [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0],
    rotationEasyEda: [values[4] ?? 0, values[5] ?? 0, values[3] ?? 0],
    offsetMil: [values[6] ?? 0, values[7] ?? 0, values[8] ?? 0]
  }
}

async function cachedResolve(cacheDir: string | undefined, key: string, load: () => Promise<ResolvedJlcModel>): Promise<ResolvedJlcModel> {
  const file = cacheDir ? path.join(cacheDir, 'metadata', `${createHash('sha256').update(key).digest('hex')}.json`) : null
  if (file) {
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as ResolvedJlcModel
      if (cached.query && cached.modelUuid && cached.url) return cached
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const resolved = await load()
  if (file) {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(resolved, null, 2))
  }
  return resolved
}

export async function resolveJlcModel(query: string, api = DEFAULT_API, packageName?: string,
  cacheDir?: string, proxy?: string): Promise<ResolvedJlcModel> {
  query = query.trim()
  if (!query || query.length > 200) throw new Error('Provide an exact MPN or LCSC code (1-200 characters)')
  return await cachedResolve(cacheDir, `${api}|${query}|${packageName ?? ''}`, async () => {
    const search = await postForm(api, '/eda/product/search',
      { keyword: query, needAggs: 'true', currPage: '1', pageSize: '20' }, proxy)
    const product = exactProduct(search, query, packageName)
    const lcsc = scalar(product.code).toUpperCase()
    const mpn = scalar(product.model)
    const device = scalar(product.hasDevice)
    if (!device) throw new Error(`${query} has no JLC device record`)
    const title = mpn || scalar(product.title) || scalar(product.name) || scalar(product.description) || lcsc || query
    const deviceResult = await postForm(api, '/devices/searchByIds', { 'uuids[]': device }, proxy) as {
      result?: { attributes?: Record<string, unknown> }[]
    }
    const attributes = deviceResult.result?.[0]?.attributes
    const modelUuid = scalar(attributes?.['3D Model'])
    if (!modelUuid) throw new Error(`${query} has no JLC 3D model`)
    const componentResult = await postForm(api, '/components/searchByIds?forceOnline=1',
      { 'uuids[]': modelUuid, dataStr: 'yes' }, proxy) as { result?: { dataStr?: string }[] }
    const data = JSON.parse(componentResult.result?.[0]?.dataStr ?? '') as { model?: unknown }
    const modelFile = scalar(data.model)
    if (!modelFile || modelFile.includes('..')) throw new Error(`${query} returned an invalid JLC model filename`)
    const url = new URL(modelFile.replace(/^\/+/, ''), DEFAULT_MODEL_ROOT)
    if (url.protocol !== 'https:' || url.hostname !== 'modules.lceda.cn') throw new Error(`${query} returned an untrusted model URL`)
    return { query, lcsc, mpn, manufacturer: scalar(attributes?.Manufacturer), package: scalar(attributes?.['Supplier Footprint']),
      title, modelUuid, modelFile, url: url.href, transform: parseJlcTransform(attributes?.['3D Model Transform']),
      attribution: { library: '嘉立创EDA/EasyEDA官方库', links: ['https://lceda.cn/', 'https://easyeda.com'] },
      resolvedAt: new Date().toISOString() }
  })
}

export async function downloadJlcModel(query: string, out: string, api = DEFAULT_API, overwrite = false,
  packageName?: string, cacheDir?: string, proxy?: string): Promise<DownloadedJlcModel> {
  const actualCache = cacheDir ?? path.join(out, '.jlc-cache')
  const model = await resolveJlcModel(query, api, packageName, actualCache, proxy)
  const cacheFile = path.join(actualCache, 'step', `${model.modelUuid}.step`)
  let bytes: Buffer
  try {
    bytes = await readFile(cacheFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    bytes = await requestBytes(model.url, { headers: { 'User-Agent': 'silkreel-cad/0.1' } }, proxy)
    await mkdir(path.dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, bytes)
  }
  if (!bytes.subarray(0, 256).toString('utf8').replace(/^\uFEFF/, '').trimStart().startsWith('ISO-10303-21;')) {
    throw new Error(`${query} download is not an ISO-10303-21 STEP file`)
  }
  await mkdir(out, { recursive: true })
  const target = path.join(out, safeModelName(model.lcsc || query, model.title))
  try { await access(target); if (!overwrite) throw new Error(`Model already exists: ${target}; pass --overwrite`) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await writeFile(target, bytes)
  return { query, lcsc: model.lcsc, mpn: model.mpn, manufacturer: model.manufacturer, package: model.package,
    title: model.title, modelUuid: model.modelUuid, source: model.url, file: target,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, transform: model.transform,
    attribution: model.attribution,
    resolvedAt: model.resolvedAt }
}

export async function runJlcCli(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    lcsc: { type: 'string', multiple: true }, part: { type: 'string', multiple: true }, package: { type: 'string' },
    out: { type: 'string' }, cache: { type: 'string' }, api: { type: 'string' }, proxy: { type: 'string' },
    overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, doctor: { type: 'boolean' }, json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  } })
  if (values.help) {
    console.log(HELP)
    return
  }
  if (values.doctor) {
    console.log(JSON.stringify(await discoverJlc3d(), null, 2))
    return
  }
  const queries = [...(values.lcsc ?? []), ...(values.part ?? []), ...positionals]
  if (!queries.length) throw new Error('Provide one or more exact MPNs or LCSC IDs, for example: npm run cad:jlc -- STM32F103C8T6 --out .cad-models')
  const discovery = await discoverJlc3d()
  // Never mutate a discovered user/global model library unless the caller
  // explicitly passes --out. Agent-driven repair defaults to the project tree.
  const out = path.resolve(values.out ?? path.join('exports', 'cad-models'))
  const api = values.api ?? DEFAULT_API
  const cache = path.resolve(values.cache ?? path.join(out, '.jlc-cache'))
  const proxy = values.proxy ?? process.env.JLC3D_PROXY ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
  const records: (ResolvedJlcModel | DownloadedJlcModel)[] = []
  for (const query of queries) {
    if (values['dry-run']) records.push(await resolveJlcModel(query, api, values.package, cache, proxy))
    else records.push(await downloadJlcModel(query, out, api, values.overwrite ?? false, values.package, cache, proxy))
  }
  const report = { schema: 1, api, discovery, dryRun: values['dry-run'] ?? false, models: records }
  if (values.json) console.log(JSON.stringify(report, null, 2))
  else if (values['dry-run']) for (const item of records as ResolvedJlcModel[]) {
    console.log(`${item.query}: ${item.lcsc} ${item.mpn} -> ${item.url}`)
  }
  else for (const item of records as DownloadedJlcModel[]) {
    console.log(`${item.query}: ${item.lcsc} ${item.mpn} -> ${item.file} (${item.sha256})`)
  }
  if (!values['dry-run']) {
    await mkdir(out, { recursive: true })
    await writeFile(path.join(out, 'jlc3d-models.json'), JSON.stringify(report, null, 2))
  }
}
