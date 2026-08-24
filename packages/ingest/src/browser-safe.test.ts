import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseKicadPcb, ingest, IngestError } from './index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const boardsDir = join(repoRoot, 'fixtures', 'boards')

function loadBoard(name: string): string {
  return readFileSync(`${boardsDir}/${name}`, 'utf8')
}

describe('VAL-INGEST-015 browser-safe ingestion', () => {
  it('ingests every KiCad fixture under happy-dom without node APIs in the library', () => {
    const boards = readdirSync(boardsDir).filter((f) => f.endsWith('.kicad_pcb'))
    expect(boards.length).toBeGreaterThanOrEqual(4)
    for (const board of boards) {
      const raw = readFileSync(join(boardsDir, board), 'utf8')
      const model = parseKicadPcb(raw, board)
      expect(model.source.format).toBe('kicad')
      expect(model.stats.traces).toBeGreaterThan(0)
    }
  }, 30000)

  it('generic ingest entry accepts a kicad file', () => {
    const model = ingest([{ name: 'ecc83-pp.kicad_pcb', contents: loadBoard('ecc83-pp.kicad_pcb') }])
    expect(model.source.format).toBe('kicad')
    expect(model.footprints.length).toBeGreaterThan(0)
  })

  it('rejects unknown extensions with a typed error', () => {
    expect(() => ingest([{ name: 'movie.mp4', contents: 'not a board' }])).toThrow(IngestError)
  })

  it('static scan: library sources import no node builtins', () => {
    const libFiles = ['index.ts', 'types.ts', 'errors.ts', 'sexp.ts', 'sexp-query.ts', 'kicad.ts', 'kicad-ingest.ts', 'ingest.ts']
    const banned = /from\s+'(fs|path|os|crypto|buffer|process|stream|child_process|http|https|net|url|util|events|module)(\/\w+)?'|from\s+'node:/
    for (const f of libFiles) {
      const src = readFileSync(join(repoRoot, 'packages', 'ingest', 'src', f), 'utf8')
      expect(banned.test(src), `${f} must not import node builtins`).toBe(false)
    }
  })
})
