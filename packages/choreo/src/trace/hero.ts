import type { BoardModel, Vec2 } from '@silk-reel/ingest'
import type { CastHints } from '../types'

export interface HeroPick {
  ref: string
  center: Vec2
  /** every hero pad on every copper layer — growth seeds */
  pads: Array<{ layer: string; pos: Vec2 }>
}

export function pickHero(board: BoardModel, hints?: CastHints): HeroPick | undefined {
  if (board.footprints.length === 0) return undefined
  let fp = hints?.preferRefs
    ?.map((ref) => board.footprints.find((f) => f.ref === ref && ref.startsWith('U')))
    .find((f) => f !== undefined)
  if (fp === undefined) {
    const cx = (board.bbox.min.x + board.bbox.max.x) / 2
    const cy = (board.bbox.min.y + board.bbox.max.y) / 2
    let best = -1
    let bestD = Infinity
    board.footprints.forEach((f) => {
      const n = f.padRefs.length
      const d = Math.hypot(f.pos.x - cx, f.pos.y - cy)
      if (n > best || (n === best && d < bestD)) {
        best = n
        bestD = d
        fp = f
      }
    })
  }
  if (fp === undefined) return undefined
  const hero = fp
  const pads: HeroPick['pads'] = []
  for (const [layer, copper] of Object.entries(board.copper)) {
    for (const pad of copper.pads) {
      if (pad.footprintRef === hero.ref) pads.push({ layer, pos: pad.pos })
    }
  }
  const center = pads.length > 0
    ? { x: pads.reduce((s, p) => s + p.pos.x, 0) / pads.length, y: pads.reduce((s, p) => s + p.pos.y, 0) / pads.length }
    : hero.pos
  return { ref: hero.ref, center, pads }
}
