import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseKicadPcb } from './index.js'

const board = (name: string) =>
  parseKicadPcb(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'boards', name), 'utf8'), name)

describe('stackup', () => {
  it('reads the declared mask colour, finish and thickness', () => {
    expect(board('glasgow.kicad_pcb').stackup).toEqual({ thickness: 1.6, maskColor: 'White', finish: 'None' })
    expect(board('kit-dev-coldfire-xilinx_5213.kicad_pcb').stackup.finish).toBe('ENIG')
    expect(board('video.kicad_pcb').stackup.finish).toBe('HAL lead-free')
  })

  it('falls back to 1.6 mm and no colour when the board declares no stackup', () => {
    const { stackup } = board('icebreaker.kicad_pcb')
    expect(stackup.thickness).toBe(1.6)
    expect(stackup.maskColor).toBeUndefined()
    expect(stackup.finish).toBeUndefined()
  })
})
