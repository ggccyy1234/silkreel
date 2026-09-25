import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../config'
import type { Aspect, FilmConfig } from '../types'
import { compileTrace } from './index'
import { boardModel } from '../../test/helpers'

const BOARDS = [
  'StickHub.kicad_pcb',
  'ecc83-pp.kicad_pcb',
  'glasgow.kicad_pcb',
  'icebreaker.kicad_pcb',
  'kit-dev-coldfire-xilinx_5213.kicad_pcb',
  'video.kicad_pcb'
] as const

function resolved(aspect: Aspect) {
  const config: FilmConfig = {
    style: 'trace',
    aspect,
    knobs: {},
    seed: 1,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 30 }
  }
  return resolveConfig(config)
}

for (const name of BOARDS) {
  for (const aspect of ['4:5', '16:9'] as const) {
    describe(`${name} @ ${aspect}`, () => {
      const board = boardModel(name)
      const r = resolved(aspect)
      const { scene } = compileTrace(board, r, 1)

      it('packs segs at stride 7, t0 ascending, all t within [0, 0.8]', () => {
        let total = 0
        let inBeat = 0
        for (const layer of scene.layers) {
          expect(layer.segs.length % 7).toBe(0)
          let prev = -1
          for (let i = 0; i < layer.segs.length; i += 7) {
            const t0 = layer.segs[i + 5] as number
            const t1 = layer.segs[i + 6] as number
            expect(t0).toBeGreaterThanOrEqual(prev)
            expect(t0).toBeGreaterThanOrEqual(0)
            expect(t0).toBeLessThanOrEqual(t1)
            expect(t1).toBeLessThanOrEqual(0.8)
            prev = t0
            total += 1
            if (t0 >= scene.beats.growth[0]) inBeat += 1
          }
        }
        expect(inBeat / total).toBeGreaterThanOrEqual(0.9)
      })

      it('keeps every seg endpoint and pad inside the frame', () => {
        const pad = 2
        for (const layer of scene.layers) {
          for (let i = 0; i < layer.segs.length; i += 7) {
            for (const x of [layer.segs[i] as number, layer.segs[i + 2] as number]) {
              expect(x).toBeGreaterThanOrEqual(-pad)
              expect(x).toBeLessThanOrEqual(r.width + pad)
            }
            for (const y of [layer.segs[i + 1] as number, layer.segs[i + 3] as number]) {
              expect(y).toBeGreaterThanOrEqual(-pad)
              expect(y).toBeLessThanOrEqual(r.height + pad)
            }
          }
        }
        expect(scene.pads.length).toBeGreaterThan(0)
        for (const p of scene.pads) {
          expect(p.x).toBeGreaterThanOrEqual(-pad)
          expect(p.x).toBeLessThanOrEqual(r.width + pad)
          expect(p.y).toBeGreaterThanOrEqual(-pad)
          expect(p.y).toBeLessThanOrEqual(r.height + pad)
        }
      })
    })
  }
}

describe('compileTrace performance', () => {
  it('compiles video.kicad_pcb in under 4s', () => {
    const board = boardModel('video.kicad_pcb')
    const r = resolved('4:5')
    const t0 = performance.now()
    compileTrace(board, r, 1)
    const ms = performance.now() - t0
    console.log(`compileTrace(video) = ${ms.toFixed(0)}ms`)
    expect(ms).toBeLessThan(4000)
  })
})
