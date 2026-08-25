import type { DecodedFrame } from './decode.js'

export interface FrameStats {
  index: number
  litPct: number
  mirrorRatio: number
  quadrantDeviation: number
  meanBrightness: number
  litMeanBrightness: number
  bgMeanBrightness: number
  channelSpreadMax: number
  bbox: { x0: number; y0: number; x1: number; y1: number } | undefined
  centroid: { x: number; y: number }
}

export interface AnalyzeOptions {
  litThreshold?: number
  rgb?: boolean
}

export function analyzeFrame(frame: DecodedFrame, options: AnalyzeOptions = {}): FrameStats {
  const { width, height, data, index } = frame
  const litThreshold = options.litThreshold ?? 22

  let litCount = 0
  let sumAll = 0
  let sumLit = 0
  let sumX = 0
  let sumY = 0
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1

  const quads: [number, number, number, number] = [0, 0, 0, 0]
  const midX = width / 2
  const midY = height / 2

  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      const v = data[rowBase + x] ?? 0
      sumAll += v
      if (v >= litThreshold) {
        litCount += 1
        sumLit += v
        sumX += x
        sumY += y
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
        quads[((x < midX ? 0 : 2) + (y < midY ? 0 : 1)) as 0 | 1 | 2 | 3] += 1
      }
    }
  }

  const total = width * height
  const litPct = total > 0 ? (litCount / total) * 100 : 0
  const bgCount = total - litCount
  const meanBrightness = total > 0 ? sumAll / total : 0
  const litMeanBrightness = litCount > 0 ? sumLit / litCount : 0
  const bgMeanBrightness = bgCount > 0 ? (sumAll - sumLit) / bgCount : 0

  const mirrorRatio = litPct > 0 ? computeMirrorRatio(data, width, height, litThreshold) : 0
  const quadrantDeviation = computeQuadrantDeviation(quads)
  const centroid = litCount > 0 ? { x: sumX / litCount, y: sumY / litCount } : { x: width / 2, y: height / 2 }

  return {
    index,
    litPct,
    mirrorRatio,
    quadrantDeviation,
    meanBrightness,
    litMeanBrightness,
    bgMeanBrightness,
    channelSpreadMax: 0,
    bbox: litCount > 0 && x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : undefined,
    centroid
  }
}

function computeMirrorRatio(data: Uint8Array, width: number, height: number, threshold: number): number {
  let both = 0
  let either = 0
  const lastCol = width - 1
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      const aLit = (data[rowBase + x] ?? 0) >= threshold
      const bLit = (data[rowBase + (lastCol - x)] ?? 0) >= threshold
      if (aLit || bLit) {
        either += 1
        if (aLit && bLit) both += 1
      }
    }
  }
  return either > 0 ? both / either : 1
}

function computeQuadrantDeviation(quads: [number, number, number, number]): number {
  const mean = (quads[0] + quads[1] + quads[2] + quads[3]) / 4
  if (mean === 0) return 0
  const maxDev = Math.max(...quads.map((q) => Math.abs(q - mean)))
  return maxDev / mean
}
