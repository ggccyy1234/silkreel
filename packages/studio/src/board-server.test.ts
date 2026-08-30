import { describe, expect, it } from 'vitest'
import { UnsupportedFormatError } from '@silk-reel/ingest'
import { parseKicadText } from './board-server.js'

const standaloneFootprint = `(footprint "QFN-4"
  (version 20240108)
  (generator pcbnew)
  (generator_version "8.0")
  (layer "F.Cu")
  (fp_text reference "REF**" (at 0 -2.5) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (fp_line (start -2 -2) (end 2 -2) (stroke (width 0.05) (type default)) (layer "F.CrtYd"))
  (fp_rect (start -1.5 -1.5) (end 1.5 1.5) (stroke (width 0.12) (type default)) (fill none) (layer "F.Fab"))
  (pad "1" smd custom (at -0.8 0) (size 0.8 0.8) (layers "F.Cu" "F.Paste" "F.Mask")
    (options (clearance outline) (anchor rect))
    (primitives (gr_rect (start -0.4 -0.4) (end 0.4 0.4) (width 0) (fill yes))))
  (model "\${KICAD8_3DMODEL_DIR}/Package_DFN_QFN.3dshapes/QFN-4.wrl"
    (offset (xyz 0 0 0))
    (scale (xyz 1 1 1))
    (rotate (xyz 0 0 0)))
)`

describe('studio board upload contract', () => {
  it('rejects a valid standalone module as a typed unsupported board input', () => {
    let caught: unknown
    try {
      parseKicadText('QFN-4.KICAD_MOD', standaloneFootprint)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(UnsupportedFormatError)
    if (!(caught instanceof UnsupportedFormatError)) return
    expect(caught.file).toBe('QFN-4.KICAD_MOD')
    expect(caught.reason).toContain('.kicad_mod')
    expect(caught.reason).toContain('BoardModel')
    expect(caught.reason).toContain('board inputs')
  })

  it('keeps the PCB parser on the board upload path', () => {
    const board = parseKicadText(
      'probe.kicad_pcb',
      `(kicad_pcb (version 20241229) (generator pcbnew)
        (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (36 "B.SilkS" user) (37 "F.SilkS" user) (44 "Edge.Cuts" user))
        (gr_rect (start 0 0) (end 10 5) (stroke (width 0.1) (type default)) (fill none) (layer "Edge.Cuts")))`
    )

    expect(board.source.files).toEqual(['probe.kicad_pcb'])
    expect(board.outline).toHaveLength(1)
    expect(board.bbox).toEqual({ min: { x: 0, y: 0 }, max: { x: 10, y: 5 } })
  })
})
