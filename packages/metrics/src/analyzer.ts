import type { DecodedFrame } from './decode.js'

export interface FrameStats {
  index: number
  litPct: number
  meanBrightness: number
  litMeanBrightness: number
  bgMeanBrightness: number
  /** lit pixels in the left/right halves and their balance ratio, min/max */
  litLeft: number
  litRight: number
  mirrorRatio: number
  bbox: { x0: number; y0: number; x1: number; y1: number } | undefined
  centroid: { x: number; y: number }
}

export interface AnalyzeOptions {
  litThreshold?: number
}

export function analyzeFrame(frame: DecodedFrame, options: AnalyzeOptions = {}): FrameStats {
  const { width, height, data, index } = frame
  const litThreshold = options.litThreshold ?? 22

  let litCount = 0
  let litLeft = 0
  let litRight = 0
  let sumAll = 0
  let sumLit = 0
  let sumX = 0
  let sumY = 0
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1

  const midX = width / 2
  for (let y = 0; y < height; y++) {
    const rowBase = y * width
    for (let x = 0; x < width; x++) {
      const v = data[rowBase + x] ?? 0
      sumAll += v
      if (v >= litThreshold) {
        litCount += 1
        if (x < midX) litLeft += 1
        else litRight += 1
        sumLit += v
        sumX += x
        sumY += y
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }

  const total = width * height
  const litPct = total > 0 ? (litCount / total) * 100 : 0
  const bgCount = total - litCount
  const meanBrightness = total > 0 ? sumAll / total : 0
  const litMeanBrightness = litCount > 0 ? sumLit / litCount : 0
  const bgMeanBrightness = bgCount > 0 ? (sumAll - sumLit) / bgCount : 0
  const centroid = litCount > 0 ? { x: sumX / litCount, y: sumY / litCount } : { x: width / 2, y: height / 2 }

  return {
    index,
    litPct,
    meanBrightness,
    litMeanBrightness,
    bgMeanBrightness,
    litLeft,
    litRight,
    mirrorRatio: litCount > 0 ? Math.min(litLeft, litRight) / Math.max(litLeft, litRight, 1) : 1,
    bbox: litCount > 0 && x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : undefined,
    centroid
  }
}
