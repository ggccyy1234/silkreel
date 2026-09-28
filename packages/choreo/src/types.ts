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
  /** the dot marks fill rather than stroke */
  filled?: boolean
}

/** one rendered instance of a glyph (a primary slot or a symmetry copy) */
export interface AtomState {
  x: number
  y: number
  rot: number
  scale: number
  /** unused for glyph placements — visibility comes from decodeAlpha */
  alpha: number
  /** mirrored copies flip the glyph itself so asymmetric outlines/text render mirrored */
  flipX?: boolean | undefined
  flipY?: boolean | undefined
}

/** ink weight: heroes take palette.head, the rest ride on silk tones */
export type Tone = 'hero' | 'support' | 'punct' | 'text'

/** one slot's whole symmetry group — all copies flicker in unison; nothing moves */
export interface Placement {
  glyphId: string
  /** static pose of every symmetry copy (x,y,rot,scale,flipX,flipY; alpha unused) */
  atoms: AtomState[]
  /** per-copy tone multiplier, same length as atoms (text: true copy .9, reflections .45) */
  tones: number[]
  role: Tone
  /** loop steps (1 step = 1/15 s) where decode-in starts and where decode-out starts; may wrap */
  inStep: number
  outStep: number
  /** index into the decode pattern banks */
  pattern: number
  /** index into formations[] */
  formation: number
}

/** the board's own silk screen, ghosted in as the signature beat */
export interface GlyphGhost {
  /** board silk strokes in stage units, grouped into ≤12 spatial bins that decode as units */
  bins: Array<{ strokes: FlatPath[]; hero: boolean; inStep: number; outStep: number; pattern: number }>
  label?: TitleCard | undefined
  /** stage units, just below the ghost */
  labelPos: { x: number; y: number }
}

export type FormationId = 'marks' | 'orbit' | 'ring' | 'columns' | 'quad' | 'ghost'

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
  /** glyph cadence: 'twos' holds each 15fps step for 2 frames; 'smooth' interpolates */
  cadence?: 'twos' | 'smooth'
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
  placements: Placement[]
  formations: FormationEvent[]
  /** loop length in decode steps (1 step = 1/15 s) */
  steps: number
  cadence: 'twos' | 'smooth'
  ghost: GlyphGhost
  /** single-step dips: the renderer multiplies that placement's alpha by 0.35 */
  glints: Array<{ placement: number; step: number }>
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
export interface CameraKey { t: number; cx: number; cy: number; zoom: number }
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
  /** camera keys (px, ascending t), smoothstep-sampled: frame center (cx,cy) looks at, zoom about it */
  camera: CameraKey[]
  beats: TraceBeats
}

export type CompileTimeline = (board: BoardModel, config: FilmConfig) => Timeline
