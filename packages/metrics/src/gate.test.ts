import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGate } from './gate.js'

const WIDTH = 320
const HEIGHT = 240
const FPS = 15
const FRAME_COUNT = 13
const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const REFERENCE = resolve(import.meta.dirname, '../../../fixtures/reference/pcbanimation.mp4')

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
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) target[y * WIDTH + x] = 255
  }
}

function fourPadFrame(): Uint8Array {
  const result = frame()
  const size = 32
  const x0 = 80
  const y0 = 50
  drawBox(result, x0, y0, size)
  drawBox(result, WIDTH - x0 - size, y0, size)
  drawBox(result, x0, HEIGHT - y0 - size, size)
  drawBox(result, WIDTH - x0 - size, HEIGHT - y0 - size, size)
  return result
}

function randomFrame(): Uint8Array {
  const result = frame()
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if ((x * 13 + y * 17 + x * y) % 97 < 5) result[y * WIDTH + x] = 255
    }
  }
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

function codaRule(report: Awaited<ReturnType<typeof runGate>>) {
  const rule = report.rules.find((candidate) => candidate.rule === 'sparse-four-pad-tail-black-cut')
  if (rule === undefined) throw new Error('coda rule missing from gate report')
  return rule
}

function densityRule(report: Awaited<ReturnType<typeof runGate>>) {
  const rule = report.rules.find((candidate) => candidate.rule === 'density-envelope')
  if (rule === undefined) throw new Error('density rule missing from gate report')
  return rule
}

describe('gate coda oracle', () => {
  it('accepts the tracked reference and its intended four-pad tail', async () => {
    const reference = await runGate(REFERENCE, { width: 1080, height: 1350, fps: 15, totalFrames: 167 })
    expect(reference.passed).toBe(true)
    expect(codaRule(reference).passed).toBe(true)
    expect(densityRule(reference).passed).toBe(true)

    const coda = fourPadFrame()
    const synthetic = await renderSynthetic('four-pad-coda', [frame(255), ...Array.from({ length: FRAME_COUNT - 2 }, () => coda), frame()])
    const report = await runGate(synthetic, expectations(FRAME_COUNT))
    expect(codaRule(report).passed).toBe(true)
    expect(densityRule(report).passed).toBe(false)
  }, 120000)

  it('rejects black cuts without a stable coda, including empty and random tails', async () => {
    const emptyTail = await renderSynthetic('empty-tail', [frame(255), ...Array.from({ length: FRAME_COUNT - 1 }, () => frame())])
    const random = randomFrame()
    const randomTail = await renderSynthetic('random-tail', [frame(255), ...Array.from({ length: FRAME_COUNT - 2 }, () => random), frame()])
    const [emptyReport, randomReport] = await Promise.all([
      runGate(emptyTail, expectations(FRAME_COUNT)),
      runGate(randomTail, expectations(FRAME_COUNT))
    ])

    expect(codaRule(emptyReport).passed).toBe(false)
    expect(codaRule(randomReport).passed).toBe(false)
  }, 120000)

  it('rejects a short coda and a non-black final frame', async () => {
    const coda = fourPadFrame()
    const singleFrame = await renderSynthetic('single-frame-tail', [frame(255), coda, ...Array.from({ length: FRAME_COUNT - 3 }, () => frame())])
    const nonBlackFinal = await renderSynthetic('non-black-final', [frame(255), ...Array.from({ length: FRAME_COUNT - 1 }, () => coda)])
    const [singleReport, nonBlackReport] = await Promise.all([
      runGate(singleFrame, expectations(FRAME_COUNT)),
      runGate(nonBlackFinal, expectations(FRAME_COUNT))
    ])
    expect(codaRule(singleReport).passed).toBe(false)
    expect(codaRule(nonBlackReport).passed).toBe(false)
  }, 120000)
})
