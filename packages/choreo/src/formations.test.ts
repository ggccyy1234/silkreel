import { describe, expect, it } from 'vitest'
import { buildCast } from './glyphs'
import { buildBeatMaps, copyPositions, halfExtents } from './formations'
import type { GlyphGroups, SlotMap } from './formations'
import { ASPECT_SIZE, safeArea } from './layout'
import type { Aspect, FormationId, Glyph } from './types'
import { makeRng } from './rng'
import { boardModel } from '../test/helpers'
import type { BoardModel } from '@silk-reel/ingest'

const BOARDS = [
  'ecc83-pp.kicad_pcb',
  'kit-dev-coldfire-xilinx_5213.kicad_pcb',
  'video.kicad_pcb',
  'StickHub.kicad_pcb',
  'icebreaker.kicad_pcb',
  'glasgow.kicad_pcb'
]
const SEEDS = [42, 7]
const STAGE_ASPECTS = [1, 16 / 9]
const ASPECTS: Aspect[] = ['4:5', '1:1', '9:16', '16:9']

interface Box {
  x: number
  y: number
  hw: number
  hh: number
  label: string
}

function groupCast(cast: Glyph[]): GlyphGroups {
  const groups: GlyphGroups = { packages: [], texts: [], marks: [] }
  for (const g of cast) {
    if (g.kind === 'package') groups.packages.push(g)
    else if (g.kind === 'text') groups.texts.push(g)
    else groups.marks.push(g)
  }
  return groups
}

function groupsFor(board: BoardModel, seed: number): { groups: GlyphGroups; glyphById: Map<string, Glyph> } {
  const { cast } = buildCast(board, 1, true, makeRng(seed, 'cast'))
  return { groups: groupCast(cast), glyphById: new Map(cast.map((g) => [g.id, g])) }
}

const ALL_IDS: readonly FormationId[] = ['marks', 'orbit', 'columns', 'ring', 'quad', 'marks']

/** the same beat maps compileTimeline builds for a board/seed/stageAspect */
function mapsFor(
  board: BoardModel,
  seed: number,
  stageAspect: number,
  stagePx = 432
): Map<number, SlotMap> {
  const { groups } = groupsFor(board, seed)
  return buildBeatMaps(
    groups,
    1,
    (label) => makeRng(seed, `form:${label}`),
    ALL_IDS,
    stageAspect,
    stagePx,
    [0, 1]
  )
}

function boxesOf(map: SlotMap, glyphById: Map<string, Glyph>): { texts: Box[]; obstacles: Box[] } {
  const texts: Box[] = []
  const obstacles: Box[] = []
  for (const [gid, slots] of map) {
    const glyph = glyphById.get(gid)
    if (glyph === undefined) continue
    for (const s of slots) {
      const { hw, hh } = halfExtents(s, glyph)
      for (const p of copyPositions(s)) {
        const box = { x: p.x, y: p.y, hw, hh, label: `${gid}@(${p.x.toFixed(2)},${p.y.toFixed(2)})` }
        if (glyph.kind === 'text') texts.push(box)
        else obstacles.push(box)
      }
    }
  }
  return { texts, obstacles }
}

const overlap = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh

describe('formation label collisions', () => {
  for (const name of BOARDS) {
    for (const seed of SEEDS) {
      for (const stageAspect of STAGE_ASPECTS) {
        it(`${name} seed ${seed} aspect ${stageAspect.toFixed(3)}: text boxes clear all glyphs and stay on stage`, () => {
          const { glyphById } = groupsFor(boardModel(name), seed)
          const maps = mapsFor(boardModel(name), seed, stageAspect)
          const sx = Math.min(1.15, Math.max(1, stageAspect))
          const sy = Math.min(1.15, Math.max(1, 1 / stageAspect))
          for (const map of new Set(maps.values())) {
            const { texts, obstacles } = boxesOf(map, glyphById)
            for (const [i, t] of texts.entries()) {
              for (const o of obstacles) {
                expect(overlap(t, o), `text ${t.label} overlaps ${o.label}`).toBe(false)
              }
              // other text boxes, including the slot's own symmetry twins
              for (const [j, o] of texts.entries()) {
                if (j === i) continue
                expect(overlap(t, o), `text ${t.label} overlaps ${o.label}`).toBe(false)
              }
              expect(Math.abs(t.x) + t.hw, `text ${t.label} past the stage edge`).toBeLessThanOrEqual(sx + 1e-6)
              expect(Math.abs(t.y) + t.hh, `text ${t.label} past the stage edge`).toBeLessThanOrEqual(sy + 1e-6)
            }
            for (const o of obstacles) {
              expect(Math.abs(o.x) + o.hw, `${o.label} past the stage edge`).toBeLessThanOrEqual(sx + 1e-6)
              expect(Math.abs(o.y) + o.hh, `${o.label} past the stage edge`).toBeLessThanOrEqual(sy + 1e-6)
            }
          }
        })
      }
    }
  }
})

describe('cluster normalization', () => {
  for (const name of BOARDS) {
    for (const aspect of ASPECTS) {
      it(`${name} @ ${aspect}: cluster half-extent lands in [0.38, 0.55] before aspect spread`, () => {
        const board = boardModel(name)
        const size = ASPECT_SIZE[aspect]
        const safe = safeArea(size.width, size.height, false)
        const stageAspect = safe.w / safe.h
        const stagePx = Math.min(safe.w, safe.h) * 0.5
        const sx = Math.min(1.15, Math.max(1, stageAspect))
        const sy = Math.min(1.15, Math.max(1, 1 / stageAspect))
        const { glyphById } = groupsFor(board, 42)
        const maps = mapsFor(board, 42, stageAspect, stagePx)
        for (const map of new Set(maps.values())) {
          const slotCount = [...map.values()].reduce((n, s) => n + s.length, 0)
          if (slotCount < 3) continue // sparse residue can't reach the floor
          // unspread positions to recover the normalized extent
          let extent = 0
          for (const [gid, slots] of map) {
            const glyph = glyphById.get(gid)
            if (glyph === undefined) continue
            for (const s of slots) {
              const { hw, hh } = halfExtents(s, glyph)
              for (const p of copyPositions(s)) {
                extent = Math.max(extent, Math.abs(p.x) / sx + hw, Math.abs(p.y) / sy + hh)
              }
            }
          }
          expect(extent).toBeGreaterThanOrEqual(0.38 - 0.02)
          expect(extent).toBeLessThanOrEqual(0.55 + 1e-9)
        }
      })
    }
  }
})

describe('pairwise spacing', () => {
  for (const name of BOARDS) {
    it(`${name}: no two slots' copies crowd closer than 0.4× the smaller scale`, () => {
      const board = boardModel(name)
      const { glyphById } = groupsFor(board, 42)
      for (const stageAspect of STAGE_ASPECTS) {
        const maps = mapsFor(board, 42, stageAspect)
        for (const map of new Set(maps.values())) {
          const units: Array<{ scale: number; boxes: Box[]; label: string }> = []
          for (const [gid, slots] of map) {
            const glyph = glyphById.get(gid)
            if (glyph === undefined) continue
            for (const s of slots) {
              const { hw, hh } = halfExtents(s, glyph)
              units.push({
                scale: s.scale,
                boxes: copyPositions(s).map((p) => ({ x: p.x, y: p.y, hw, hh, label: gid })),
                label: gid
              })
            }
          }
          for (let i = 0; i < units.length; i++) {
            for (let j = i + 1; j < units.length; j++) {
              const a = units[i] as (typeof units)[number]
              const b = units[j] as (typeof units)[number]
              const gap = 0.4 * Math.min(a.scale, b.scale)
              for (const ba of a.boxes) {
                for (const bb of b.boxes) {
                  const tooClose =
                    Math.abs(ba.x - bb.x) < ba.hw + bb.hw + gap &&
                    Math.abs(ba.y - bb.y) < ba.hh + bb.hh + gap
                  expect(tooClose, `${a.label} crowds ${b.label} at (${bb.x.toFixed(2)},${bb.y.toFixed(2)})`).toBe(false)
                }
              }
            }
          }
        }
      }
    })
  }
})
