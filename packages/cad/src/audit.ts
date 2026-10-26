import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseSExpr } from '@silk-reel/ingest'
import type { SExprNode } from '@silk-reel/ingest'
import type { Audit, ModelReference } from './types.js'

const lists = (n: SExprNode[], name: string): SExprNode[][] => n.filter((v): v is SExprNode[] => Array.isArray(v) && v[0] === name)
const first = (n: SExprNode[], name: string): SExprNode[] => lists(n, name)[0] ?? []
const atom = (v: SExprNode | undefined): string => typeof v === 'string' ? v : ''
const vector = (n: SExprNode[], name: string, fallback: number[]): number[] => {
  const p = first(n, name)
  const xyz = first(p, 'xyz')
  const values = (xyz.length ? xyz : p).slice(1).map(v => Number(atom(v)))
  if (!values.length) return fallback
  if (values.some(v => !Number.isFinite(v))) throw new Error(`Invalid ${name} in 3D model declaration`)
  return values
}

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function expandVariables(value: string, vars: Record<string, string>): string {
  const seen = new Set<string>()
  for (let i = 0; i < 32; i++) {
    if (seen.has(value)) throw new Error(`Cyclic path variable: ${value}`)
    seen.add(value)
    const before = value
    value = value.replace(/\$\{([^}]+)\}|\$\(([^)]+)\)/g, (match: string, a: string | undefined, b: string | undefined) => {
      const replacement = vars[a ?? b ?? '']
      if (replacement === undefined) return match
      return replacement
    })
    if (value === before) {
      // A self-reference is a cycle; unknown variables remain unresolved so the
      // audit can report their exact declarations instead of guessing a path.
      const known = [...value.matchAll(/\$\{([^}]+)\}|\$\(([^)]+)\)/g)].some(m => vars[m[1] ?? m[2] ?? ''] !== undefined)
      if (known) throw new Error(`Cyclic path variable: ${value}`)
      return value
    }
  }
  throw new Error('Path variable expansion exceeded 32 levels')
}

export function rewriteModelPaths(source: string, paths: (string | null)[]): string {
  // The AST intentionally discards token quoting. Re-serializing it could turn
  // a layer's user-defined string into a keyword. Replace only model path tokens
  // in the original source; all other bytes stay untouched.
  const tokens = source.matchAll(/\(|\)|"(?:\\[\s\S]|[^"\\])*"|[^\s()"]+/g)
  const stack: { first: boolean; modelPath: boolean }[] = []
  let index = 0, previous = 0, output = ''
  for (const token of tokens) {
    const raw = token[0]
    if (raw === '(') { stack.push({ first: true, modelPath: false }); continue }
    if (raw === ')') { stack.pop(); continue }
    const context = stack.at(-1)
    if (!context) continue
    if (context.first) { context.first = false; context.modelPath = raw === 'model'; continue }
    if (!context.modelPath) continue
    context.modelPath = false
    if (index >= paths.length) throw new Error('Unexpected model declaration during source staging')
    const replacement = paths[index++]
    if (replacement) {
      const escaped = replacement.replace(/\\/g, '/').replace(/"/g, '\\"')
      output += source.slice(previous, token.index) + `"${escaped}"`
      previous = token.index + raw.length
    }
  }
  if (index !== paths.length) throw new Error('Model declaration count changed during source staging')
  return output + source.slice(previous)
}

async function readVariables(file: string): Promise<Record<string, string>> {
  try {
    const json = JSON.parse(await readFile(file, 'utf8')) as { text_variables?: Record<string, string> }
    return json.text_variables ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function auditBoard(input: string, variables: Record<string, string>, modelMap: Record<string, string> = {}): Promise<{ audit: Audit; stagedSource: string }> {
  input = path.resolve(input)
  const bytes = await readFile(input)
  const root = parseSExpr(bytes.toString('utf8'), input)
  if (root[0] !== 'kicad_pcb') throw new Error('Input is not a KiCad PCB')
  const env = Object.fromEntries(Object.entries(process.env).filter((v): v is [string, string] => typeof v[1] === 'string'))
  const vars: Record<string, string> = { ...env, ...await readVariables(input.replace(/\.kicad_pcb$/i, '.kicad_pro')), ...variables, KIPRJMOD: path.dirname(input) }
  const usedVariables: Record<string, string> = { KIPRJMOD: path.dirname(input) }
  const models: ModelReference[] = []
  const withoutModels: string[] = []
  const hashes = new Map<string, string>()
  const footprints = root.filter((node): node is SExprNode[] => Array.isArray(node) && (node[0] === 'footprint' || node[0] === 'module'))
  for (const fp of footprints) {
    const prop = lists(fp, 'property').find(p => p[1] === 'Reference')
    const ref = atom(prop?.[2]) || atom(lists(fp, 'fp_text').find(p => p[1] === 'reference')?.[2]) || '(unnamed)'
    const declarations = lists(fp, 'model')
    if (!declarations.some(m => !m.includes('hide') && first(m, 'hide')[1] !== 'yes')) withoutModels.push(ref)
    for (const m of declarations) {
      const source = atom(m[1])
      for (const variable of source.matchAll(/\$\{([^}]+)\}|\$\(([^)]+)\)/g)) {
        const key = variable[1] ?? variable[2] ?? ''
        if (vars[key] !== undefined) usedVariables[key] = vars[key]
      }
      const visible = !m.includes('hide') && first(m, 'hide')[1] !== 'yes'
      const expanded = expandVariables(modelMap[source] ?? source, vars)
      const resolved = /\$\{|\$\(|^[a-z][a-z0-9+-]*:\/\//i.test(expanded) ? null : path.resolve(path.dirname(input), expanded)
      let exists = false
      if (resolved) {
        try { exists = (await stat(resolved)).isFile() } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (exists && resolved && !hashes.has(resolved)) hashes.set(resolved, sha256(await readFile(resolved)))
      models.push({ ref, footprint: atom(fp[1]), side: atom(first(fp, 'layer')[1]), source, visible,
        position: vector(fp, 'at', [0, 0, 0]), offset: vector(m, 'offset', [0, 0, 0]),
        rotation: vector(m, 'rotate', [0, 0, 0]), scale: vector(m, 'scale', [1, 1, 1]),
        resolved: exists ? resolved : null, sha256: resolved ? hashes.get(resolved) ?? null : null })
      // Resolve *only* the declared path or an explicit user mapping. No basename search,
      // package-name lookup, extension substitution, or geometry synthesis.
    }
  }
  const audit: Audit = { input, sha256: sha256(bytes), models, withoutModels, missing: models.filter(m => m.visible && !m.resolved), variables: usedVariables }
  return { audit, stagedSource: rewriteModelPaths(bytes.toString('utf8'), models.map(m => m.resolved)) }
}
