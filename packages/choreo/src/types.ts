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
  /** hold-drift rotation direction — orbit's inner ring counter-rotates */
  turn?: number | undefined
  /** this atom is the formation's hero — the renderer inks it palette.head */
  hero?: boolean | undefined
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

export type FormationId = 'marks' | 'spine' | 'totem' | 'columns' | 'ring' | 'quad' | 'grid' | 'orbit'

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

export type StyleId = 'trace' | 'glyph'
export type Aspect = '4:5' | '1:1' | '9:16' | '16:9'
export type PaletteId = 'mono' | 'copper' | 'blueprint' | 'phosphor'

export interface Palette {
  id: PaletteId | 'custom'
  bg: string
  /** main copper/ink */
  copper: string
  /** back-side / inner copper, zones */
  copperDim: string
  silk: string
  /** growing trace heads, flashes — the bloom source */
  head: string
  /** 0..1 bloom strength for the post pass */
  bloom: number
}

export interface TitleCard {
  name: string
  version?: string | undefined
}

export interface Knobs {
  /** scales cast size / crowding, 0.5-1.5 */
  density?: number
  /** silkscreen text glyphs on/off, 0 or 1 */
  texts?: number
  /** playback speed, 0.75-1.5; duration = base / tempo */
  tempo?: number
}

export interface FilmConfig {
  style?: StyleId
  aspect?: Aspect
  palette?: PaletteId
  /** #rrggbb — overrides palette.head and tints copper */
  accent?: string
  title?: TitleCard
  /** alpha-capable output: no background, no vignette/grain */
  transparent?: boolean
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

interface TimelineBase {
  fps: number
  totalFrames: number
  durationSeconds: number
  width: number
  height: number
  output: { width: number; height: number; fps: number }
  palette: Palette
  title?: TitleCard | undefined
  transparent: boolean
  warnings: TimelineWarning[]
  seedUsed: number
}

export interface GlyphTimeline extends TimelineBase {
  style: 'glyph'
  cast: Glyph[]
  tracks: Track[]
  formations: FormationEvent[]
  /** safeArea w/h — formations widen on wide frames, deepen on tall ones */
  stageAspect: number
}

export interface TraceTimeline extends TimelineBase {
  style: 'trace'
  scene: TraceScene
}

export type Timeline = GlyphTimeline | TraceTimeline

/** closed polyline, flat [x0,y0,x1,y1,...] */
export type FlatPath = number[]

export interface TraceLayer {
  id: string
  side: 'F' | 'B' | 'inner'
  /** stride 7: x0,y0,x1,y1,widthPx,t0,t1 — (x0,y0) is where growth starts; sorted by t0 */
  segs: number[]
}
export interface TracePad {
  x: number; y: number; w: number; h: number; rot: number
  shape: 'rect' | 'round' | 'circle'
  /** pop-in time */
  t: number
  side: 'F' | 'B' | 'both'
  /** mounting holes and oversized pads draw as rings, never filled blobs */
  ring?: boolean | undefined
}
export interface TraceVia { x: number; y: number; r: number; t: number }
export interface TraceZone { fill: FlatPath; side: 'F' | 'B' | 'inner'; t0: number; t1: number }
export interface TraceText { text: string; x: number; y: number; size: number; rot: number; t: number }
export interface TraceBeats {
  outline: [number, number]
  pads: [number, number]
  growth: [number, number]
  zones: [number, number]
  silk: [number, number]
  hold: [number, number]
  fade: [number, number]
}
export interface TraceScene {
  outline: FlatPath[]
  layers: TraceLayer[]          // draw order: back → front
  pads: TracePad[]
  vias: TraceVia[]
  /** drilled holes (pads, vias, mounts) — the constellation that fades in with the outline */
  drills: Array<{ x: number; y: number; r: number }>
  zones: TraceZone[]
  silkStrokes: Array<{ path: FlatPath; t: number }>
  texts: TraceText[]
  /** growth origin (hero footprint center), px — used by zone wipe + glint */
  origin: { x: number; y: number }
  /** slow push-in about the frame center */
  camera: { from: number; to: number }
  beats: TraceBeats
}

export type CompileTimeline = (board: BoardModel, config: FilmConfig) => Timeline
