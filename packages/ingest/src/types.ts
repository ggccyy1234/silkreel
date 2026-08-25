export interface Vec2 {
  x: number
  y: number
}

export interface BBox {
  min: Vec2
  max: Vec2
}

export type LayerKind = 'copper' | 'silk' | 'mask' | 'drill' | 'outline'

export type LayerSide = 'F' | 'B' | 'inner' | null

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  side: LayerSide
}

export type PadShape = 'rect' | 'circle' | 'oval' | 'roundrect' | 'trapezoid' | 'custom' | 'teardrop'

export interface Pad {
  id: string
  pos: Vec2
  size: Vec2
  shape: PadShape
  rot: number
  netId?: number | undefined
  footprintRef?: string | undefined
}

export interface Trace {
  id: string
  points: Vec2[]
  width: number
  netId?: number | undefined
}

export interface Via {
  id: string
  pos: Vec2
  dia: number
  drill: number
  netId?: number | undefined
}

export interface Zone {
  id: string
  outline: Vec2[]
  holes: Vec2[][]
  netId?: number | undefined
}

export interface Arc {
  id: string
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
  width: number
}

export interface Text {
  id: string
  value: string
  refdes?: string | undefined
  pos: Vec2
  rot: number
  height: number
  mirrored: boolean
  footprintRef?: string | undefined
}

export interface Footprint {
  ref: string
  value?: string | undefined
  pos: Vec2
  rot: number
  layer: string
  padRefs: string[]
  silkRefs: string[]
}

export type DrillPlated = boolean

export interface DrillHit {
  id: string
  pos: Vec2
  dia: number
  plated: DrillPlated
}

export interface NetNodeRef {
  elementKind: 'trace' | 'pad' | 'via' | 'zone'
  elementId: string
  footprintRef?: string | undefined
}

export interface Net {
  id: number
  name: string
  nodeRefs: NetNodeRef[]
}

export interface BoardStats {
  traces: number
  pads: number
  vias: number
  zones: number
  texts: number
  drills: number
}

export interface CopperLayers {
  traces: Trace[]
  pads: Pad[]
  vias: Via[]
  zones: Zone[]
}

export interface SilkLayer {
  lines: Trace[]
  arcs: Arc[]
  texts: Text[]
}

export interface BoardSource {
  format: 'kicad' | 'gerber'
  files: string[]
  boardName: string
}

export interface BoardModel {
  source: BoardSource
  bbox: BBox
  outline: Path[]
  layers: Layer[]
  copper: Record<string, CopperLayers>
  silkscreen: Record<string, SilkLayer>
  footprints: Footprint[]
  drill: DrillHit[]
  nets: Net[]
  stats: BoardStats
  warnings: IngestWarning[]
}

export interface Path {
  id: string
  points: Vec2[]
  closed: boolean
  layerId: string
}

export interface IngestWarning {
  code: string
  message: string
}
