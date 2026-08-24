import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseKicadPcb } from './kicad-ingest.js'

import { join } from 'node:path'
const boardsDir = join(process.cwd(), 'fixtures', 'boards')

function loadBoard(name: string): string {
  return readFileSync(`${boardsDir}/${name}`, 'utf8')
}

describe('VAL-INGEST-012 coordinate frame consistency', () => {
  const models = ['ecc83-pp', 'StickHub', 'video', 'kit-dev-coldfire-xilinx_5213'].map((name) => ({
    name,
    model: parseKicadPcb(loadBoard(`${name}.kicad_pcb`), `${name}.kicad_pcb`)
  }))

  it('has finite positive-area bbox with plausible extents', () => {
    for (const { name, model } of models) {
      expect(Number.isFinite(model.bbox.min.x), name).toBe(true)
      expect(Number.isFinite(model.bbox.max.y), name).toBe(true)
      expect(model.bbox.min.x).toBeLessThan(model.bbox.max.x)
      expect(model.bbox.min.y).toBeLessThan(model.bbox.max.y)
      const w = model.bbox.max.x - model.bbox.min.x
      const h = model.bbox.max.y - model.bbox.min.y
      expect(w).toBeGreaterThan(1)
      expect(h).toBeGreaterThan(1)
      expect(w).toBeLessThan(1000)
      expect(h).toBeLessThan(1000)
    }
  })

  it('contains every element position within the inflated bbox', () => {
    for (const { name, model } of models) {
      const eps = 1
      let worst = 0
      const check = (x: number, y: number): void => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        const dx = Math.max(model.bbox.min.x - eps - x, x - model.bbox.max.x - eps, 0)
        const dy = Math.max(model.bbox.min.y - eps - y, y - model.bbox.max.y - eps, 0)
        worst = Math.max(worst, Math.hypot(dx, dy))
      }
      for (const c of Object.values(model.copper)) {
        for (const t of c.traces) for (const p of t.points) check(p.x, p.y)
        for (const p of c.pads) check(p.pos.x, p.pos.y)
        for (const v of c.vias) check(v.pos.x, v.pos.y)
        for (const z of c.zones) for (const p of z.outline) check(p.x, p.y)
      }
      for (const s of Object.values(model.silkscreen)) {
        for (const l of s.lines) for (const p of l.points) check(p.x, p.y)
        for (const t of s.texts) check(t.pos.x, t.pos.y)
      }
      for (const d of model.drill) check(d.pos.x, d.pos.y)
      for (const o of model.outline) for (const p of o.points) check(p.x, p.y)
      expect(worst, `${name} worst outside-distance`).toBe(0)
    }
  })
})

describe('VAL-INGEST-013 footprint grouping exclusivity', () => {
  for (const name of ['ecc83-pp.kicad_pcb', 'StickHub.kicad_pcb']) {
    it(`resolves every ref exclusively on ${name}`, () => {
      const model = parseKicadPcb(loadBoard(name), name)

      interface PadEntry {
        footprintRef?: string | undefined
      }
      const padsById = new Map<string, PadEntry>()
      for (const c of Object.values(model.copper)) {
        for (const pad of c.pads) {
          if (pad.footprintRef === undefined) continue
          padsById.set(pad.id, pad)
        }
      }

      const claimedBy = new Map<string, string>()
      for (const fp of model.footprints) {
        expect(Array.isArray(fp.padRefs)).toBe(true)
        expect(Array.isArray(fp.silkRefs)).toBe(true)
        for (const key of fp.padRefs) {
          expect(padsById.has(key), `dangling padRef ${key}`).toBe(true)
          const prev = claimedBy.get(key)
          expect(prev, `pad ${key} claimed by ${prev} and ${fp.ref}`).toBeUndefined()
          claimedBy.set(key, fp.ref)
        }
        for (const sref of fp.silkRefs) {
          expect(typeof sref).toBe('string')
        }
      }

      const groupedRefs = new Set<string>()
      for (const fp of model.footprints) for (const k of fp.padRefs) groupedRefs.add(k)
      expect(groupedRefs.size, 'grouped pad keys').toBe(padsById.size)

      for (const fp of model.footprints) {
        const maxPadSpan = Math.max(
          ...Object.values(model.copper).flatMap((c) =>
            c.pads
              .filter((p) => p.footprintRef === fp.ref)
              .map((p) => Math.hypot(p.pos.x - fp.pos.x, p.pos.y - fp.pos.y))
          ),
          1
        )
        const rad = Math.PI * (fp.rot / 180)
        const cos = Math.cos(-rad)
        const sin = Math.sin(-rad)
        for (const c of Object.values(model.silkscreen)) {
          for (const t of c.texts) {
            if (t.footprintRef !== fp.ref) continue
            const dx = t.pos.x - fp.pos.x
            const dy = t.pos.y - fp.pos.y
            const lx = dx * cos - dy * sin
            const ly = dx * sin + dy * cos
            expect(Math.hypot(lx, ly), `silk text of ${fp.ref} outside local extent`).toBeLessThanOrEqual(
              maxPadSpan + 6 + t.height * 2
            )
          }
        }
      }
    })
  }
})

describe('VAL-INGEST-014 stats recomputed truth', () => {
  for (const name of ['ecc83-pp.kicad_pcb', 'StickHub.kicad_pcb', 'video.kicad_pcb', 'kit-dev-coldfire-xilinx_5213.kicad_pcb']) {
    it(`matches exact recount on ${name}`, () => {
      const model = parseKicadPcb(loadBoard(name), name)
      const recomputed = {
        traces: Object.values(model.copper).reduce((n, c) => n + c.traces.length, 0),
        pads: new Set(Object.values(model.copper).flatMap((c) => c.pads)).size,
        vias: Object.values(model.copper).reduce((n, c) => n + c.vias.length, 0),
        zones: Object.values(model.copper).reduce((n, c) => n + c.zones.length, 0),
        texts: Object.values(model.silkscreen).reduce((n, s) => n + s.texts.length, 0),
        drills: model.drill.length
      }
      expect(recomputed.traces).toBe(model.stats.traces)
      expect(recomputed.vias).toBe(model.stats.vias)
      expect(recomputed.zones).toBe(model.stats.zones)
      expect(recomputed.texts).toBe(model.stats.texts)
      expect(recomputed.drills).toBe(model.stats.drills)
      expect(recomputed.pads).toBe(model.stats.pads)
    })
  }
})

describe('VAL-INGEST-016 vias are first-class', () => {
  const model = parseKicadPcb(loadBoard('video.kicad_pcb'), 'video.kicad_pcb')

  it('has vias with real diameters and drill <= dia', () => {
    const allVias = Object.values(model.copper).flatMap((c) => c.vias)
    expect(allVias.length).toBeGreaterThan(0)
    expect(model.stats.vias).toBe(allVias.length)
    let minDia = Infinity
    let maxDia = 0
    let maxDrill = 0
    for (const via of allVias) {
      expect(via.dia).toBeGreaterThan(0)
      expect(via.drill).toBeGreaterThan(0)
      expect(via.drill).toBeLessThanOrEqual(via.dia + 1e-9)
      minDia = Math.min(minDia, via.dia)
      maxDia = Math.max(maxDia, via.dia)
      maxDrill = Math.max(maxDrill, via.drill)
    }
    expect(minDia).toBeLessThan(maxDia || minDia * 2)
    expect(maxDrill).toBeLessThan(maxDia)
  })

  it('never places vias inside pad arrays', () => {
    for (const [layerId, c] of Object.entries(model.copper)) {
      const padPositions = new Set(c.pads.map((p) => `${p.pos.x.toFixed(4)},${p.pos.y.toFixed(4)}`))
      for (const via of c.vias) {
        expect(padPositions.has(`${via.pos.x.toFixed(4)},${via.pos.y.toFixed(4)}`), `via leaked into pads on ${layerId}`).toBe(false)
      }
    }
  })
})
