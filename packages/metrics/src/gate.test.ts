import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGate } from './gate.js'

const WIDTH = 320
const HEIGHT = 240
const FPS = 15
const FRAME_COUNT = 30
const FFMPEG = '/opt/homebrew/bin/ffmpeg'

let workDir: string | undefined

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'metrics-gate-'))
})

afterAll(async () => {
  if (workDir !== undefined) await rm(workDir, { recursive: true, force: true })
})

function frame(value = 0): Uint8Array {
  return new Uint8Array(WIDTH * HEIGHT).fill(value)
}

function drawBox(target: Uint8Array, x0: number, y0: number, size: number): void {
  for (let y = y0; y < y0 + size && y < HEIGHT; y++) {
    for (let x = x0; x < x0 + size && x < WIDTH; x++) target[y * WIDTH + x] = 255
  }
}

/** a mirrored pair of white boxes — the abstract film's smallest symmetric unit */
function pairFrame(size: number, pairs = 1): Uint8Array {
  const result = frame()
  for (let i = 0; i < pairs; i++) {
    const x = Math.round(WIDTH * 0.2 + i * WIDTH * 0.12)
    const y = Math.round(HEIGHT * 0.35 + i * HEIGHT * 0.12)
    drawBox(result, x, y, size)
    drawBox(result, WIDTH - x - size, y, size)
  }
  return result
}

function lopsidedFrame(size: number): Uint8Array {
  const result = frame()
  drawBox(result, Math.round(WIDTH * 0.2), Math.round(HEIGHT * 0.4), size)
  return result
}

function pgm(data: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(`P5\n${WIDTH} ${HEIGHT}\n255\n`), Buffer.from(data)])
}

async function renderSynthetic(name: string, frames: readonly Uint8Array[]): Promise<string> {
  const dir = workDir
  if (dir === undefined) throw new Error('test workspace missing')
  const imageDir = join(dir, name)
  await mkdir(imageDir, { recursive: true })
  for (let i = 0; i < frames.length; i++) {
    const data = frames[i]
    if (data === undefined) throw new Error(`missing synthetic frame ${i}`)
    await writeFile(join(imageDir, `f${String(i).padStart(3, '0')}.pgm`), pgm(data))
  }
  const output = join(dir, `${name}.mp4`)
  await new Promise<void>((resolvePromise, reject) => {
    execFile(FFMPEG, [
      '-y',
      '-f', 'image2',
      '-framerate', String(FPS),
      '-i', join(imageDir, 'f%03d.pgm'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      output
    ], { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err !== null) reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`))
      else resolvePromise()
    })
  })
  return output
}

function expectations(totalFrames: number): Parameters<typeof runGate>[1] {
  return { width: WIDTH, height: HEIGHT, fps: FPS, totalFrames }
}

function rule(report: Awaited<ReturnType<typeof runGate>>, name: string) {
  const found = report.rules.find((candidate) => candidate.rule === name)
  if (found === undefined) throw new Error(`rule ${name} missing from gate report`)
  return found
}

/** sparse symmetric clip: black -> wave -> trough -> bigger wave -> black (loops) */
function loopFrames(): Uint8Array[] {
  const frames: Uint8Array[] = [frame(), frame(), frame()]
  // wave 1 builds to ~1.3% lit (two 22px boxes = 968/76800)
  for (const s of [8, 14, 22, 22, 18, 10]) frames.push(pairFrame(s))
  // trough — one small pair, ~0.26%
  for (let i = 0; i < 4; i++) frames.push(pairFrame(10))
  // wave 2 — two pairs of 22px = 1936/76800 ≈ 2.5%
  for (let i = 0; i < 6; i++) frames.push(pairFrame(22, 2))
  // dissolve back to black
  frames.push(pairFrame(14))
  frames.push(pairFrame(8))
  while (frames.length < FRAME_COUNT) frames.push(frame())
  return frames
}

describe('glyph-film gate', () => {
  it('passes a reference-shaped clip: dark, sparse, symmetric, breathing, closed loop', async () => {
    const mp4 = await renderSynthetic('glyph-good', loopFrames())
    const report = await runGate(mp4, expectations(FRAME_COUNT))
    for (const name of ['spec-exact', 'dark-ground', 'coverage', 'symmetry-always', 'breathing', 'loop-closure', 'motion-present']) {
      expect(rule(report, name).passed, `${name}: ${rule(report, name).detail}`).toBe(true)
    }
    expect(report.passed).toBe(true)
  }, 120000)

  it('fails a permanently black video on coverage and breathing', async () => {
    const mp4 = await renderSynthetic('glyph-black', Array.from({ length: FRAME_COUNT }, () => frame()))
    const report = await runGate(mp4, expectations(FRAME_COUNT))
    expect(rule(report, 'coverage').passed).toBe(false)
    expect(rule(report, 'breathing').passed).toBe(false)
    expect(report.passed).toBe(false)
  }, 120000)

  it('fails asymmetric content on symmetry-always', async () => {
    const frames: Uint8Array[] = [frame(), frame()]
    for (let i = 0; i < FRAME_COUNT - 2; i++) frames.push(lopsidedFrame(20))
    const mp4 = await renderSynthetic('glyph-asym', frames)
    const report = await runGate(mp4, expectations(FRAME_COUNT))
    expect(rule(report, 'symmetry-always').passed).toBe(false)
    expect(report.passed).toBe(false)
  }, 120000)

  it('fails a dense slab on coverage and dark-ground', async () => {
    const dense = frame()
    for (let y = Math.round(HEIGHT * 0.2); y < HEIGHT * 0.8; y++) {
      for (let x = Math.round(WIDTH * 0.2); x < WIDTH * 0.8; x++) dense[y * WIDTH + x] = 255
    }
    const mp4 = await renderSynthetic('glyph-dense', Array.from({ length: FRAME_COUNT }, () => dense))
    const report = await runGate(mp4, expectations(FRAME_COUNT))
    expect(rule(report, 'coverage').passed).toBe(false)
    expect(rule(report, 'dark-ground').passed).toBe(false)
    expect(report.passed).toBe(false)
  }, 120000)

  it('fails a clip whose last frame does not match the first (broken loop)', async () => {
    const frames = loopFrames()
    frames[FRAME_COUNT - 1] = pairFrame(40, 2)
    const mp4 = await renderSynthetic('glyph-unclosed', frames)
    const report = await runGate(mp4, expectations(FRAME_COUNT))
    expect(rule(report, 'loop-closure').passed).toBe(false)
    expect(report.passed).toBe(false)
  }, 120000)

  it('fails a flat unbreathing clip on breathing and motion', async () => {
    const mp4 = await renderSynthetic('glyph-flat', Array.from({ length: FRAME_COUNT }, () => pairFrame(22)))
    const report = await runGate(mp4, expectations(FRAME_COUNT))
    expect(rule(report, 'breathing').passed).toBe(false)
    expect(rule(report, 'motion-present').passed).toBe(false)
    expect(report.passed).toBe(false)
  }, 120000)

  it('fails on wrong dimensions or frame count', async () => {
    const mp4 = await renderSynthetic('glyph-spec', loopFrames())
    const report = await runGate(mp4, { width: WIDTH * 2, height: HEIGHT, fps: FPS, totalFrames: FRAME_COUNT })
    expect(rule(report, 'spec-exact').passed).toBe(false)
    expect(report.passed).toBe(false)
  }, 120000)
})
