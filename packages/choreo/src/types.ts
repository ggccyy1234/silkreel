import type { BoardModel, Vec2 } from '@silk-reel/ingest'

export type GlyphKind = 'package' | 'text' | 'mark'

/** text rendered inside a package glyph, in normalized glyph space */
export interface GlyphLabel {
  text: string
  x: number
  y: number
  /** height as a fraction of the glyph's unit span */
  size: number
  /** rotation in glyph space, radians */
  rot: number
}

/** a cast glyph: unit-normalized strokes centered at origin, or a text string */
export interface Glyph {
  id: string
  kind: GlyphKind
  /** polylines in normalized space, max dimension = 1 */
  strokes: Vec2[][]
  /** text glyphs draw this instead of strokes */
  text?: string
  /** package glyphs may carry silkscreen labels drawn inside the outline */
  labels?: GlyphLabel[]
}

/** one rendered instance of a glyph (a primary slot or a symmetry copy) */
export interface AtomState {
  x: number
  y: number
  rot: number
  scale: number
  alpha: number
  /** mirrored copies flip the glyph itself so asymmetric outlines/text render mirrored */
  flipX?: boolean | undefined
  flipY?: boolean | undefined
  /** reveal rank 0..1 inside a transition — pops are a spatial script, not a blur */
  order?: number | undefined
}

export interface TrackKnot {
  /** cyclic position on the loop, [0,1) ascending */
  phase: number
  /** expanded copy instances sorted canonically (angle, then radius) */
  atoms: AtomState[]
  /** set when the bracket starting at this knot is a formation transition —
   *  carries the global evac/dead/build split shared by all tracks */
  transit?: { evacEnd: number; buildStart: number } | undefined
}

export interface Track {
  glyphId: string
  /** glyph weight class — heroes settle longer than marks on arrival */
  kind: GlyphKind
  knots: TrackKnot[]
}

export type FormationId = 'marks' | 'spine' | 'totem' | 'columns' | 'ring' | 'quad'

export interface FormationEvent {
  id: FormationId
  /** hold region on the loop; transitions happen between holds */
  startPhase: number
  endPhase: number
  /** index into the beat sequence — formation ids repeat (marks interludes) */
  beat: number
}

/** per-board cast curation: listed refs/texts are preferred as hero glyphs */
export interface CastHints {
  preferRefs?: string[]
  preferTexts?: string[]
}

export interface Knobs {
  /** scales cast size and per-formation crowding, 0.5-1.5 */
  density?: number
  /** silkscreen text glyphs on/off, 0 or 1 */
  texts?: number
}

export interface FilmConfig {
  knobs: Knobs
  seed: number | null
  duration: 'auto' | number
  output: { width: number; height: number; fps: number }
  cast?: CastHints
}

export interface TimelineWarning {
  code: string
  message: string
}

export interface Timeline {
  fps: number
  totalFrames: number
  durationSeconds: number
  width: number
  height: number
  output: { width: number; height: number; fps: number }
  cast: Glyph[]
  tracks: Track[]
  formations: FormationEvent[]
  warnings: TimelineWarning[]
  seedUsed: number
}

export type CompileTimeline = (board: BoardModel, config: FilmConfig) => Timeline
