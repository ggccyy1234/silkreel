import { describe, expect, it } from 'vitest'
import { buildCast } from './glyphs'
import { buildBeatMaps, copyPositions, halfExtents, planBeats } from './formations'
import type { GlyphGroups, SlotMap } from './formations'
import type { Glyph } from './types'
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

/** the same beat maps compileTimeline builds for a board/seed/stageAspect */
function mapsFor(board: BoardModel, seed: number, stageAspect: number): Map<number, SlotMap> {
  const { cast } = buildCast(board, 1, true, makeRng(seed, 'cast'))
  const groups = groupCast(cast)
  const plan = planBeats(groups, makeRng(seed, `plan:${board.source.boardName}`))
  return buildBeatMaps(groups, 1, (label) => makeRng(seed, `form:${label}`), plan, stageAspect)
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
          const { cast } = buildCast(boardModel(name), 1, true, makeRng(seed, 'cast'))
          const glyphById = new Map(cast.map((g) => [g.id, g]))
          const maps = mapsFor(boardModel(name), seed, stageAspect)
          const sx = Math.max(1, stageAspect)
          const sy = Math.max(1, 1 / stageAspect)
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
              expect(Math.abs(t.y) + t.hh).toBeLessThanOrEqual(sy + 1e-6)
            }
            for (const o of obstacles) {
              expect(Math.abs(o.x) + o.hw, `${o.label} past the stage edge`).toBeLessThanOrEqual(sx + 1e-6)
              expect(Math.abs(o.y) + o.hh).toBeLessThanOrEqual(sy + 1e-6)
            }
          }
        })
      }
    }
  }
})
