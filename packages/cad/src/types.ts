export interface ModelReference {
  ref: string
  footprint: string
  side: string
  source: string
  visible: boolean
  position: number[]
  offset: number[]
  rotation: number[]
  scale: number[]
  resolved: string | null
  sha256: string | null
}

export interface Audit {
  input: string
  sha256: string
  models: ModelReference[]
  footprints: FootprintIdentity[]
  withoutModels: string[]
  missing: ModelReference[]
  variables: Record<string, string>
}

export interface FootprintIdentity {
  reference: string
  footprint: string
  side: string
  value: string | null
  mpn: string | null
  manufacturer: string | null
  supplierPart: string | null
  lcsc: string | null
  package: string | null
  padCount: number
  npthOnly: boolean
  properties: Record<string, string>
}

export interface GeometryInfo {
  meshes: number
  triangles: number
  bounds: { min: number[]; max: number[]; size: number[] }
  materials: number
}

export interface Manifest {
  schema: 1
  input: string
  inputSha256: string
  converter: string
  converterVersion: string
  model: string
  modelSha256: string
  modelUnits: 'meter'
  sourceKind: 'pcb' | 'step' | 'glb'
  tessellationMm: number | null
  geometry: GeometryInfo
  audit: Audit | null
  repair?: { sourcePcb: string; stagedPcb: string; repaired: boolean; report: string | null; records: number }
  nativeReport?: import('./native.js').NativeReport
  notes: string[]
  manufacturing?: { file: string; sha256: string; pcb: string; pcbSha256: string; duration: number; curveErrorMm: number; missingInStep: string[] }
}

export interface ViewSettings {
  width: number
  height: number
  elevation: number
  azimuth: number
  side: 'top' | 'bottom'
  background: string
  transparent: boolean
  title: string
  film?: boolean
}
