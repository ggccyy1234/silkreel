import type { BoardModel } from './types.js'
import { parseKicadPcb } from './kicad-ingest.js'
import { IngestError, UnsupportedFormatError } from './errors.js'

export interface InputFile {
  name: string
  contents: string
}

type GerberIngest = (files: InputFile[]) => BoardModel

let gerberImpl: GerberIngest | undefined

export function registerGerberIngest(impl: GerberIngest): void {
  gerberImpl = impl
}

export function ingest(files: InputFile[]): BoardModel {
  if (files.length === 0) {
    throw new IngestError('(no files)', 'no input files provided')
  }
  const kicadFiles = files.filter((f) => /\.kicad_pcb$/i.test(f.name))
  const gerberFiles = files.filter((f) => /\.(gtl|gbl|gml|gko|gts|gbs|gto|gbo|gtp|gbp|drl|drd|xln)$/i.test(f.name))
  const unknownFiles = files.filter((f) => !/\.kicad_pcb$/i.test(f.name) && !/\.(gtl|gbl|gml|gko|gts|gbs|gto|gbo|gtp|gbp|drl|drd|xln)$/i.test(f.name))

  if (kicadFiles.length > 0) {
    if (kicadFiles.length > 1) {
      throw new UnsupportedFormatError(
        kicadFiles.map((f) => f.name).join(', '),
        'multiple .kicad_pcb files provided; ingest expects exactly one board file per call'
      )
    }
    const first = kicadFiles[0]
    if (first === undefined) {
      throw new IngestError('(kicad)', 'kicad file slot empty')
    }
    return parseKicadPcb(first.contents, first.name)  }

  if (gerberFiles.length > 0 && unknownFiles.length === 0) {
    if (gerberImpl === undefined) {
      throw new UnsupportedFormatError(
        gerberFiles[0]?.name ?? '(gerber)',
        'gerber/excellon ingestion is not registered in this build'
      )
    }
    const result = gerberImpl(files)
    return result
  }

  throw new UnsupportedFormatError(
    files[0]?.name ?? '(unknown)',
    `no recognizable board files among: ${files.map((f) => f.name).join(', ')}`
  )
}
