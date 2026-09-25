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

async function renderImagesToMp4(name: string, imageFactory: () => string): Promise<string> {
  const dir = workDir
  if (dir === undefined) throw new Error('test workspace missing')
  const imagesDir = join(dir, name)
  await rm(imagesDir, { recursive: true, force: true })
  const { mkdir } = await import('node:fs/promises')
  await mkdir(imagesDir, { recursive: true })
  for (let i = 0; i < FRAME_COUNT; i++) {
    await writeFile(join(imagesDir, `f${String(i).padStart(3, '0')}`), Buffer.from(imageFactory(), 'binary'))
  }
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

function ffmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/opt/homebrew/bin/ffmpeg', args, { timeout: 30000 }, (err, _stdout, stderr) => {
      if (err !== null) reject(new Error(`ffmpeg failed: ${stderr.slice(-500)}`))
      else resolve()
    })
  })
}

describe('metrics analyzer against synthetic ground truth', () => {
  it('litPct matches the constructed lit fraction on decoded frames', async () => {
    const areaPx = Math.round(0.1 * W * H)
    const bw = 100
    const bh = Math.round(areaPx / bw)
    const px = emptyPixels()
    drawBox(px, 0, 0, bw, bh)
    const expectedPct = ((bw * bh) / (W * H)) * 100

    const mp4 = await renderImagesToMp4('lit', (): string => toPbm(px))
    const facts = await probeVideo(mp4)
    let checked = 0
    for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
      const stats = analyzeFrame(frame)
      expect(Math.abs(stats.litPct - expectedPct)).toBeLessThanOrEqual(Math.max(0.35, expectedPct * 0.03))
      checked += 1
    }
    expect(checked).toBeGreaterThan(0)
  }, 60000)

  it('bbox and centroid track the lit region', async () => {
    const px = emptyPixels()
    drawBox(px, Math.round(W * 0.5), Math.round(H * 0.5), Math.round(W * 0.2), Math.round(H * 0.2))
    const mp4 = await renderImagesToMp4('bbox', (): string => toPbm(px))
    const facts = await probeVideo(mp4)
    for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
      const stats = analyzeFrame(frame)
      expect(stats.bbox).toBeDefined()
      expect(stats.bbox?.x0).toBeGreaterThan(W * 0.4)
      expect(stats.centroid.x).toBeGreaterThan(W * 0.5)
      expect(stats.centroid.y).toBeGreaterThan(H * 0.5)
    }
  }, 60000)

  it('a black frame reports zero lit coverage', async () => {
    const mp4 = await renderImagesToMp4('black', (): string => grayPgm(0))
    const facts = await probeVideo(mp4)
    for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
      const stats = analyzeFrame(frame)
      expect(stats.litPct).toBeLessThan(0.5)
      expect(stats.bbox).toBeUndefined()
    }
  }, 60000)

  it('mirrorRatio is ~1 for symmetric content and ~0 for one-sided content', async () => {
    const sym = emptyPixels()
    drawBox(sym, 10, 100, 20, 20)
    drawBox(sym, W - 30, 100, 20, 20)
    const symMp4 = await renderImagesToMp4('mirror-sym', (): string => toPbm(sym))
    const symFacts = await probeVideo(symMp4)
    for await (const frame of decodeGrayFrames(symMp4, { width: symFacts.width, height: symFacts.height })) {
      expect(analyzeFrame(frame).mirrorRatio).toBeGreaterThan(0.9)
    }
    const lopsided = emptyPixels()
    drawBox(lopsided, 10, 100, 20, 20)
    const lopMp4 = await renderImagesToMp4('mirror-lop', (): string => toPbm(lopsided))
    const lopFacts = await probeVideo(lopMp4)
    for await (const frame of decodeGrayFrames(lopMp4, { width: lopFacts.width, height: lopFacts.height })) {
      expect(analyzeFrame(frame).mirrorRatio).toBeLessThan(0.05)
    }
  }, 60000)

  it('uniform gray level reports matching meanBrightness', async () => {
    const level = 100
    const mp4 = await renderImagesToMp4('flat', (): string => grayPgm(level))
    const facts = await probeVideo(mp4)
    for await (const frame of decodeGrayFrames(mp4, { width: facts.width, height: facts.height })) {
      const stats = analyzeFrame(frame)
      expect(Math.abs(stats.meanBrightness - level)).toBeLessThan(6)
    }
  }, 60000)

  it('probeVideo reports exact container facts for a rendered clip', async () => {
    const mp4 = await renderImagesToMp4('probe', (): string => grayPgm(40))
    const facts = await probeVideo(mp4)
    expect(facts.width).toBe(W)
    expect(facts.height).toBe(H)
    expect(Math.abs(facts.fps - FPS)).toBeLessThan(0.01)
    expect(facts.codec).toBe('h264')
    expect(facts.pixFmt).toBe('yuv420p')
    expect(facts.audioStreamCount).toBe(0)
  }, 60000)
})
