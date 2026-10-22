import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig, TraceTimeline } from '@silk-reel/choreo'
import { parseKicadPcb } from '@silk-reel/ingest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWav, loudness, traceScore } from './score-audio.js'

const board = parseKicadPcb(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'boards', 'ecc83-pp.kicad_pcb'), 'utf8'), 'ecc83-pp.kicad_pcb')
const cfg: FilmConfig = { style: 'trace', knobs: {}, seed: 42, duration: 'auto', output: { width: 540, height: 675, fps: 30 } }
const tl = compileTimeline(board, cfg) as TraceTimeline

describe('trace score audio', () => {
  const a = traceScore(tl)

  it('runs the length of the film in stereo, under a −1 dB ceiling', () => {
    expect(a.left.length).toBe(Math.round(tl.durationSeconds * a.sampleRate))
    expect(a.right.length).toBe(a.left.length)
    let peak = 0
    for (let i = 0; i < a.left.length; i++) peak = Math.max(peak, Math.abs(a.left[i] as number), Math.abs(a.right[i] as number))
    expect(peak).toBeGreaterThan(0.2)
    expect(peak).toBeLessThanOrEqual(0.89)
  })

  it('hits at power-on after a held breath', () => {
    const at = (t: number): number => {
      let e = 0
      const s0 = Math.round(t * a.sampleRate)
      for (let i = s0; i < s0 + a.sampleRate * 0.15; i++) e += (a.left[i] as number) ** 2
      return e
    }
    const on = tl.scene.acts.power[0] * tl.durationSeconds
    expect(at(on)).toBeGreaterThan(at(on - 0.6) * 4)
    expect(at(on)).toBeGreaterThan(at(2))
  })

  it('masters to the web loudness target', () => {
    expect(loudness(a.left, a.right)).toBeGreaterThan(-15)
    expect(loudness(a.left, a.right)).toBeLessThan(-13)
  })

  it('is deterministic and encodes to a 16-bit stereo WAV', () => {
    const b = traceScore(tl)
    expect(b.left.slice(0, 2000)).toEqual(a.left.slice(0, 2000))
    const wav = encodeWav(a.left, a.right, a.sampleRate)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt16LE(22)).toBe(2)
    expect(wav.length).toBe(44 + a.left.length * 4)
  })
})
