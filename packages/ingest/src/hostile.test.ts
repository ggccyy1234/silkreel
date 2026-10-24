import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseKicadPcb } from './kicad-ingest.js'
import { IngestError } from './errors.js'

import { join } from 'node:path'
const boardsDir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'boards')

function loadBoard(name: string): string {
  return readFileSync(`${boardsDir}/${name}`, 'utf8')
}

describe('VAL-INGEST-007 hostile inputs fail with typed errors', () => {
  const cases: { label: string; name: string; contents: string }[] = [
    { label: 'empty string', name: 'empty.kicad_pcb', contents: '' },
    { label: 'plain nonsense text', name: 'nonsense.kicad_pcb', contents: 'this is not a pcb' },
    { label: 'random binary bytes', name: 'binary.kicad_pcb', contents: '\x00\x01\x02\xff\xfe\x93\x7f\x00\x13binaryjunk' },
    {
      label: 'truncated mid-s-expression',
      name: 'truncated.kicad_pcb',
      contents: loadBoard('ecc83-pp.kicad_pcb').slice(0, 60000)
    }
  ]

  for (const c of cases) {
    it(`rejects ${c.label} with a typed error naming the file`, () => {
      let caught: unknown
      try {
        parseKicadPcb(c.contents, c.name)
      } catch (err) {
        caught = err
      }
      expect(caught, `expected rejection for ${c.label}`).toBeInstanceOf(Error)
      expect(caught).toBeInstanceOf(IngestError)
      const e = caught as IngestError
      expect(e.message).toContain(c.name)
      expect(e.reason.length).toBeGreaterThan(0)
      expect(['SyntaxError', 'RangeError', 'TypeError']).not.toContain((caught as Error).name)
    })
  }
})

describe('VAL-INGEST-009 large board parses under 2s', () => {
  const raw = readFileSync(`${boardsDir}/video.kicad_pcb`, 'utf8')
  const expectedCounts = (() => parseKicadPcb(raw, 'video.kicad_pcb'))()

  function timed(): { ms: number; model: ReturnType<typeof parseKicadPcb> } {
    const t0 = performance.now()
    const model = parseKicadPcb(raw, 'video.kicad_pcb')
    return { ms: performance.now() - t0, model }
  }

  it('completes full ingest in <2000ms median with identical counts', () => {
    timed()
    const runs = [timed(), timed(), timed()]
    const times = runs.map((r) => r.ms)
    times.sort((a, b) => a - b)
    const median = times[1] as number
    console.log(
      JSON.stringify({
        assertion: 'VAL-INGEST-009',
        runsMs: times,
        medianMs: Number(median.toFixed(1)),
        stats: expectedCounts.stats
      })
    )
    for (const r of runs) {
      expect(r.model.stats).toEqual(expectedCounts.stats)
      expect(r.model.footprints.length).toBe(expectedCounts.footprints.length)
      expect(r.model.nets.length).toBe(expectedCounts.nets.length)
    }
    expect(median).toBeLessThan(2000)
  }, 20000)

  it('reports the documented board scale', () => {
    expect(expectedCounts.stats.traces).toBeGreaterThanOrEqual(7900)
    expect(expectedCounts.footprints.length).toBeGreaterThanOrEqual(150)
    console.log(JSON.stringify({ traces: expectedCounts.stats.traces, footprints: expectedCounts.footprints.length }))
  })
})
