import { describe, expect, it } from 'vitest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig, TraceTimeline } from '@silk-reel/choreo'
import { parseKicadPcb } from '@silk-reel/ingest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeWav, traceScore } from './score-audio.js'

const board = parseKicadPcb(readFileSync(join(import.meta.dirname, '..', '..', '..', 'fixtures', 'boards', 'ecc83-pp.kicad_pcb'), 'utf8'), 'ecc83-pp.kicad_pcb')
const cfg: FilmConfig = { style: 'trace', knobs: {}, seed: 42, duration: 'auto', output: { width: 540, height: 675, fps: 30 } }
const tl = compileTimeline(board, cfg) as TraceTimeline

describe('trace score audio', () => {
  const a = traceScore(tl)

  it('runs the length of the film in stereo, peak-limited', () => {
    expect(a.left.length).toBe(Math.round(tl.durationSeconds * a.sampleRate))
    expect(a.right.length).toBe(a.left.length)
    let peak = 0
    for (let i = 0; i < a.left.length; i++) peak = Math.max(peak, Math.abs(a.left[i] as number), Math.abs(a.right[i] as number))
    expect(peak).toBeGreaterThan(0.5)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('hits on the slam: the loudest moment is at the impact', () => {
    const at = (t: number): number => {
      let e = 0
      const s0 = Math.round(t * a.sampleRate)
      for (let i = s0; i < s0 + a.sampleRate * 0.15; i++) e += (a.left[i] as number) ** 2
      return e
    }
    const slam = tl.scene.acts.slam[1] * tl.durationSeconds
    expect(at(slam)).toBeGreaterThan(at(slam - 1.5))
    expect(at(slam)).toBeGreaterThan(at(2))
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
