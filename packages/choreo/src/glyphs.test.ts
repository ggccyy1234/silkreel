import { describe, expect, it } from 'vitest'
import { buildCast } from './glyphs'
import { makeRng } from './rng'
import { boardModel } from '../test/helpers'
import type { BoardModel, Footprint, Vec2 } from '@silk-reel/ingest'

const BOARDS = [
  'ecc83-pp.kicad_pcb',
  'kit-dev-coldfire-xilinx_5213.kicad_pcb',
  'video.kicad_pcb',
  'StickHub.kicad_pcb',
  'icebreaker.kicad_pcb',
  'glasgow.kicad_pcb'
]

const castOf = (board: BoardModel, seed = 42) =>
  buildCast(board, 1, true, makeRng(seed, 'cast'))

const footprintByRef = (board: BoardModel, ref: string): Footprint | undefined =>
  board.footprints.find((f) => f.ref === ref)

/** the footprint's silk strokes, normalized exactly as glyphs.ts does */
function normalizedSilk(board: BoardModel, fp: Footprint): { pts: Vec2[]; cx: number; cy: number; span: number } {
  const lineById = new Map<string, Vec2[]>()
  for (const layer of Object.values(board.silkscreen)) {
    for (const line of layer.lines) lineById.set(line.id, line.points)
  }
  const pts: Vec2[] = []
  for (const ref of fp.silkRefs) {
    const line = lineById.get(ref)
    if (line !== undefined) pts.push(...line)
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { pts, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, span: Math.max(maxX - minX, maxY - minY) }
}

describe('glyph cast — silk-only vocabulary', () => {
  for (const name of BOARDS) {
    it(`${name}: package strokes come only from the footprint's own silk lines`, () => {
      const board = boardModel(name)
      const { cast } = castOf(board)
      const pkgs = cast.filter((g) => g.kind === 'package')
      expect(pkgs.length).toBeGreaterThan(0)
      for (const g of pkgs) {
        const fp = footprintByRef(board, g.id.slice(4))
        expect(fp, `${g.id} has no source footprint`).toBeDefined()
        if (fp === undefined) continue
        const silk = normalizedSilk(board, fp)
        // simplification only ever keeps input points, so every stroke point
        // must match a real silk vertex within rounding of the normalization
        const tol = 0.02 * Math.max(1e-6, silk.span)
        for (const stroke of g.strokes) {
          for (const p of stroke) {
            const bx = p.x * silk.span + silk.cx
            const by = p.y * silk.span + silk.cy
            const onSilk = silk.pts.some((q) => Math.hypot(q.x - bx, q.y - by) < tol)
            expect(onSilk, `${g.id} point (${p.x.toFixed(2)},${p.y.toFixed(2)}) is not on ${fp.ref}'s silk`).toBe(true)
          }
        }
      }
    })

    it(`${name}: package glyphs stay at or under the 20-stroke cap`, () => {
      const { cast } = castOf(boardModel(name))
      for (const g of cast.filter((g) => g.kind === 'package')) {
        expect(g.strokes.length, `${g.id} has ${g.strokes.length} strokes`).toBeLessThanOrEqual(20)
      }
    })
  }
})

describe('board-derived marks', () => {
  it('glasgow carries fiducial, mount and test-point marks (older KiCad refdes form)', () => {
    const { cast } = castOf(boardModel('glasgow.kicad_pcb'))
    const ids = new Set(cast.map((g) => g.id))
    expect(ids.has('bmark:fiducial')).toBe(true)
    expect(ids.has('bmark:mount')).toBe(true)
    expect(ids.has('bmark:tp')).toBe(true)
    // board marks rank ahead of the synthetic bench
    const firstBmark = cast.findIndex((g) => g.id.startsWith('bmark:'))
    const firstMark = cast.findIndex((g) => g.id.startsWith('mark:'))
    expect(firstBmark).toBeGreaterThanOrEqual(0)
    expect(firstBmark).toBeLessThan(firstMark)
  })

  it('StickHub carries a mount mark for its H refdes', () => {
    const { cast } = castOf(boardModel('StickHub.kicad_pcb'))
    expect(cast.some((g) => g.id === 'bmark:mount')).toBe(true)
  })

  it('a board with no qualifying artifacts still gets the synthetic marks', () => {
    const { cast } = castOf(boardModel('ecc83-pp.kicad_pcb'))
    const ids = new Set(cast.map((g) => g.id))
    expect(ids.has('mark:dot')).toBe(true)
    expect(ids.has('mark:dash')).toBe(true)
    expect(ids.has('mark:plus')).toBe(true)
    expect(ids.has('mark:bracket')).toBe(true)
    expect(ids.has('mark:sparkle')).toBe(true)
  })
})
