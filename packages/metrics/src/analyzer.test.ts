import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { probeVideo, decodeGrayFrames, analyzeFrame } from './index.js'

const W = 320
const H = 240
const FPS = 15
const FRAME_COUNT = 3

let workDir: string | undefined

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'metrics-gt-'))
})

afterAll(async () => {
  if (workDir !== undefined) await rm(workDir, { recursive: true, force: true })
})

type Pixels = boolean[][]

function emptyPixels(): Pixels {
  return Array.from({ length: H }, () => Array.from({ length: W }, () => false))
}

function drawBox(px: Pixels, x0: number, y0: number, boxW: number, boxH: number): void {
  for (let y = y0; y < y0 + boxH && y < H; y++) {
    const row = px[y]
    if (!row) continue
    for (let x = x0; x < x0 + boxW && x < W; x++) row[x] = true
  }
}

function mirrorXOf(px: Pixels): Pixels {
  return px.map((row) => [...row].reverse())
}

function orInto(target: Pixels, source: Pixels): void {
  for (let y = 0; y < H; y++) {
    const tRow = target[y]
    const sRow = source[y]
    if (!tRow || !sRow) continue
    for (let x = 0; x < W; x++) {
      if (sRow[x]) tRow[x] = true
    }
  }
}

function toPbm(px: Pixels): string {
  const rows = px.map((row) => row.map((v) => (v ? '0' : '1')).join(''))
  return `P4\n${W} ${H}\n${rows.map((r) => binaryRowBytes(r)).join('')}`
}

function binaryRowBits(row: string): string {
  let bits = row
  while (bits.length % 8 !== 0) bits += '0'
  return bits
}

function binaryRowBytes(bits: string): string {
  const padded = binaryRowBits(bits)
  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 8) {
    bytes.push(parseInt(padded.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes).toString('binary')
}

function grayPgm(level: number): string {
  const header = `P5\n${W} ${H}\n255\n`
  return header + Buffer.alloc(W * H, level).toString('binary')
}

async function renderImagesToMp4(name: string, imageFactory: () => string, isColor: boolean): Promise<string> {
  const dir = workDir
  if (dir === undefined) throw new Error('test workspace missing')
  const imagesDir = join(dir, name)
  await mkSingleFrameFiles(imagesDir, imageFactory, isColor)
  const mp4Path = join(dir, `${name}.mp4`)
  await ffmpeg([
    '-y',
    '-f', 'image2',
    '-framerate', String(FPS),
    '-i', join(imagesDir, 'f%03d'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    mp4Path
  ])
  return mp4Path
}

async function mkSingleFrameFiles(dir: string, factory: () => string, _isColor: boolean): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  for (let i = 0; i < FRAME_COUNT; i++) {
    await writeFile(join(dir, `f${String(i).padStart(3, '0')}`), Buffer.from(factory(), 'binary'))
  }
}

function ffmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/opt/homebrew/bin/ffmpeg', args, { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err !== null) reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`))
      else resolve()
    })
  })
}

async function analyzeAll(mp4Path: string): Promise<number[]> {
  const facts = await probeVideo(mp4Path)
  const out: number[] = []
  for await (const frame of decodeGrayFrames(mp4Path, { width: facts.width, height: facts.height })) {
    out.push(analyzeFrame(frame).mirrorRatio)
  }
  expect(out.length).toBeGreaterThan(0)
  return out
}

describe('VAL-FILM-018 metrics analyzer against synthetic ground truth', () => {
  it('asymmetric single-quadrant pattern measures mirrorRatio near 0.0 (±0.05)', async () => {
    const px = emptyPixels()
    drawBox(px, Math.round(W * 0.06), Math.round(H * 0.08), Math.round(W * 0.2), Math.round(H * 0.2))
    const mp4 = await renderImagesToMp4('asym', (): string => toPbm(px), false)
    const ratios = await analyzeAll(mp4)
    for (const ratio of ratios) expect(ratio).toBeLessThan(0.02)
  }, 60000)

  it('perfect mirrored pair measures mirrorRatio near 1.0 (±0.02)', async () => {
    const left = emptyPixels()
    drawBox(left, Math.round(W * 0.08), Math.round(H * 0.3), Math.round(W * 0.16), Math.round(H * 0.25))
    const px = emptyPixels()
    orInto(px, left)
    orInto(px, mirrorXOf(left))
    const mp4 = await renderImagesToMp4('mirror', (): string => toPbm(px), false)
    const ratios = await analyzeAll(mp4)
    for (const ratio of ratios) expect(ratio).toBeGreaterThan(0.98)
  }, 60000)

  it('litPct matches constructed lit fraction within tolerance on decoded frames', async () => {
    const areaPx = Math.round(0.1 * W * H)
    const bw = 100
    const bh = Math.round(areaPx / bw)
    const px = emptyPixels()
    drawBox(px, 0, 0, bw, bh)
    const expectedPct = ((bw * bh) / (W * H)) * 100

    const ppmLike = toPbm(px)
    void ppmLike
    const dir = workDir
    if (dir === undefined) throw new Error('test workspace missing')
    const imagesDir = join(dir, 'lit')
    await rm(imagesDir, { recursive: true, force: true })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(imagesDir, { recursive: true })
    for (let i = 0; i < FRAME_COUNT; i++) {
      await writeFile(join(imagesDir, `f${String(i).padStart(3, '0')}`), Buffer.from(toPbm(px), 'binary'))
    }
    const mp4 = join(dir, 'lit.mp4')
    await ffmpeg([
      '-y',
      '-f', 'image2',
      '-framerate', String(FPS),
      '-i', join(imagesDir, 'f%03d'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      mp4
    ])
    const facts = await probeVideo(mp4)
    let checked = 0
    for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
      const stats = analyzeFrame(frame)
      expect(Math.abs(stats.litPct - expectedPct)).toBeLessThanOrEqual(Math.max(0.35, expectedPct * 0.03))
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  }, 60000)

  it('quadrant balance separates unbalanced from balanced four-box constructions', async () => {
    const q = Math.round(W * 0.15)

    const bad = emptyPixels()
    drawBox(bad, 0, 0, q, q)
    const good = emptyPixels()
    drawBox(good, 0, 0, q, q)
    drawBox(good, W - q, 0, q, q)
    drawBox(good, 0, H - q, q, q)
    drawBox(good, W - q, H - q, q, q)

    const deviationsFor = async (px: Pixels): Promise<number[]> => {
      const mp4 = await renderImagesToMp4(`quad-${q}-${px === bad ? 'bad' : 'good'}`, (): string => toPbm(px), false)
      const facts = await probeVideo(mp4)
      const devs: number[] = []
      for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
        devs.push(analyzeFrame(frame).quadrantDeviation)
      }
      return devs
    }

    const badDevs = await deviationsFor(bad)
    const goodDevs = await deviationsFor(good)
    for (const dev of badDevs) expect(dev).toBeGreaterThan(1.5)
    for (const dev of goodDevs) expect(dev).toBeLessThan(0.05)
  }, 90000)

  it('uniform gray level reports matching meanBrightness', async () => {
    const level = 100
    const mp4 = await renderImagesToMp4('flat', (): string => grayPgm(level), false)
    const facts = await probeVideo(mp4)
    for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
      const stats = analyzeFrame(frame)
      expect(Math.abs(stats.meanBrightness - level)).toBeLessThan(6)
    }
  }, 60000)

  it('probeVideo reports exact container facts for a rendered clip', async () => {
    const mp4 = await renderImagesToMp4('probe', (): string => grayPgm(40), false)
    const facts = await probeVideo(mp4)
    expect(facts.width).toBe(W)
    expect(facts.height).toBe(H)
    expect(Math.abs(facts.fps - FPS)).toBeLessThan(0.01)
    expect(facts.codec).toBe('h264')
    expect(facts.pixFmt).toBe('yuv420p')
  }, 60000)
})
