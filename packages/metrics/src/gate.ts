import { probeVideo, decodeGrayFrames } from './decode.js'
import { analyzeFrame } from './analyzer.js'
import type { FrameStats } from './analyzer.js'

export interface GateRuleResult {
  rule: string
  passed: boolean
  detail: string
}

export interface GateReport {
  file: string
  passed: boolean
  facts: {
    width: number
    height: number
    fps: number
    durationSeconds: number
    frameCount: number | undefined
    codec: string | undefined
    pixFmt: string | undefined
    audioStreamCount: number
  }
  rules: GateRuleResult[]
}

export interface GateExpectations {
  width: number
  height: number
  fps: number
  totalFrames: number
}

const BG_LIMIT = 15
const FIELD_LIMIT = 25
const LIT_THRESHOLD = 22
const COVERAGE_MIN_PEAK = 0.5
const COVERAGE_MAX_PEAK = 4
const MIRROR_MIN_RATIO = 0.8
const MIRROR_MIN_LIT = 0.15
const BREATHING_MIN_MAXIMA = 2
const BREATHING_END_RATIO = 0.3
const LOOP_MEAN_DIFF_LIMIT = 2
const MOTION_MIN_MEAN_DIFF = 0.15

interface Envelope {
  stats: FrameStats[]
  peakLitPct: number
  bgMeanMax: number
  fieldMeanMax: number
  maximaCount: number
  headMeanLit: number
  tailMeanLit: number
  worstMirrorRatio: number
  mirrorCheckedFrames: number
  loopMeanDiff: number
  motionMeanDiff: number
}

async function measureEnvelope(videoPath: string): Promise<{ facts: Awaited<ReturnType<typeof probeVideo>>; envelope: Envelope }> {
  const facts = await probeVideo(videoPath)
  const stats: FrameStats[] = []
  let firstData: Uint8Array | undefined
  let lastData: Uint8Array | undefined
  let prevData: Uint8Array | undefined
  let motionDiffSum = 0
  for await (const frame of decodeGrayFrames(videoPath, { width: facts.width, height: facts.height })) {
    if (firstData === undefined) firstData = frame.data
    if (prevData !== undefined) {
      let d = 0
      for (let i = 0; i < frame.data.length; i++) d += Math.abs((frame.data[i] as number) - (prevData[i] as number))
      motionDiffSum += d / frame.data.length
    }
    prevData = frame.data
    lastData = frame.data
    stats.push(analyzeFrame(frame, { litThreshold: LIT_THRESHOLD }))
  }
  if (stats.length === 0 || firstData === undefined || lastData === undefined) {
    throw new Error(`no frames decoded from ${videoPath}`)
  }
  const motionMeanDiff = motionDiffSum / Math.max(1, stats.length - 1)

  const litSeries = stats.map((s) => s.litPct)
  const peakLitPct = Math.max(...litSeries)

  // prominent maxima on the smoothed series — each build/dissolve wave counts once
  const smoothed = litSeries.map((_, i) => {
    const lo = Math.max(0, i - 2)
    const hi = Math.min(litSeries.length - 1, i + 2)
    let sum = 0
    for (let k = lo; k <= hi; k++) sum += litSeries[k] as number
    return sum / (hi - lo + 1)
  })
  let maximaCount = 0
  for (let i = 1; i < smoothed.length - 1; i++) {
    const v = smoothed[i] as number
    if (v > (smoothed[i - 1] as number) && v >= (smoothed[i + 1] as number) && v >= peakLitPct * 0.25) maximaCount += 1
  }

  const decile = Math.max(1, Math.floor(stats.length * 0.1))
  const mean = (slice: FrameStats[]): number =>
    slice.reduce((sum, s) => sum + s.litPct, 0) / Math.max(1, slice.length)
  const headMeanLit = mean(stats.slice(0, decile))
  const tailMeanLit = mean(stats.slice(stats.length - decile))

  const mirrorChecked = stats.filter((s) => s.litPct > MIRROR_MIN_LIT)
  const worstMirrorRatio = mirrorChecked.length > 0 ? Math.min(...mirrorChecked.map((s) => s.mirrorRatio)) : 1

  let loopDiffSum = 0
  for (let i = 0; i < firstData.length; i++) loopDiffSum += Math.abs((firstData[i] as number) - (lastData[i] as number))
  const loopMeanDiff = loopDiffSum / firstData.length

  return {
    facts,
    envelope: {
      stats,
      peakLitPct,
      bgMeanMax: Math.max(...stats.map((s) => s.bgMeanBrightness)),
      fieldMeanMax: Math.max(...stats.map((s) => s.meanBrightness)),
      maximaCount,
      headMeanLit,
      tailMeanLit,
      worstMirrorRatio,
      mirrorCheckedFrames: mirrorChecked.length,
      loopMeanDiff,
      motionMeanDiff
    }
  }
}

function checkSpec(facts: Awaited<ReturnType<typeof probeVideo>>, expect: GateExpectations): GateRuleResult {
  const expectedDuration = expect.totalFrames / expect.fps
  const frameCountOk = facts.frameCount === undefined || facts.frameCount === expect.totalFrames
  const durationTolerance = Math.max(1 / expect.fps, 0.05)
  const durationOk = frameCountOk && Math.abs(facts.durationSeconds - expectedDuration) <= durationTolerance
  const fpsOk = Math.abs(facts.fps - expect.fps) < 0.01
  const specOk =
    facts.width === expect.width &&
    facts.height === expect.height &&
    fpsOk &&
    durationOk &&
    facts.codec === 'h264' &&
    facts.pixFmt === 'yuv420p' &&
    facts.audioStreamCount === 0
  const parts: string[] = []
  if (facts.width !== expect.width || facts.height !== expect.height) {
    parts.push(`resolution ${facts.width}x${facts.height} != ${expect.width}x${expect.height}`)
  }
  if (!fpsOk) parts.push(`fps ${facts.fps} != ${expect.fps}`)
  if (!frameCountOk) parts.push(`frameCount ${String(facts.frameCount)} != ${expect.totalFrames}`)
  if (!durationOk) parts.push(`duration ${facts.durationSeconds.toFixed(3)}s != ${expectedDuration.toFixed(3)}s`)
  if (facts.codec !== 'h264') parts.push(`codec ${String(facts.codec)} != h264`)
  if (facts.pixFmt !== 'yuv420p') parts.push(`pix_fmt ${String(facts.pixFmt)} != yuv420p`)
  if (facts.audioStreamCount !== 0) parts.push(`audio streams ${facts.audioStreamCount} != 0`)
  return {
    rule: 'spec-exact',
    passed: specOk,
    detail: specOk
      ? `${facts.width}x${facts.height}@${facts.fps.toFixed(2)}, ${facts.codec}/${facts.pixFmt}, video only, ${facts.durationSeconds.toFixed(3)}s`
      : parts.join('; ')
  }
}

function checkBackground(envelope: Envelope): GateRuleResult {
  const passed = envelope.bgMeanMax <= BG_LIMIT && envelope.fieldMeanMax <= FIELD_LIMIT
  return {
    rule: 'dark-ground',
    passed,
    detail: `max background mean ${envelope.bgMeanMax.toFixed(2)}/255 vs limit ${BG_LIMIT}; max field mean ${envelope.fieldMeanMax.toFixed(2)}/255 vs limit ${FIELD_LIMIT}`
  }
}

function checkCoverage(envelope: Envelope): GateRuleResult {
  const passed = envelope.peakLitPct >= COVERAGE_MIN_PEAK && envelope.peakLitPct <= COVERAGE_MAX_PEAK
  return {
    rule: 'coverage',
    passed,
    detail: `peak lit ${envelope.peakLitPct.toFixed(2)}% vs expected ${COVERAGE_MIN_PEAK}-${COVERAGE_MAX_PEAK}%`
  }
}

function checkSymmetry(envelope: Envelope): GateRuleResult {
  const passed = envelope.mirrorCheckedFrames > 0 && envelope.worstMirrorRatio >= MIRROR_MIN_RATIO
  return {
    rule: 'symmetry-always',
    passed,
    detail: `worst mirror ratio ${envelope.worstMirrorRatio.toFixed(3)} over ${envelope.mirrorCheckedFrames} frames with lit > ${MIRROR_MIN_LIT}% (min ${MIRROR_MIN_RATIO})`
  }
}

function checkBreathing(envelope: Envelope): GateRuleResult {
  const floor = envelope.peakLitPct * BREATHING_END_RATIO
  const passed =
    envelope.maximaCount >= BREATHING_MIN_MAXIMA &&
    envelope.headMeanLit < floor &&
    envelope.tailMeanLit < floor
  return {
    rule: 'breathing',
    passed,
    detail: `${envelope.maximaCount} density maxima (min ${BREATHING_MIN_MAXIMA}); head ${envelope.headMeanLit.toFixed(2)}% / tail ${envelope.tailMeanLit.toFixed(2)}% vs ${(floor).toFixed(2)}% floor from peak ${envelope.peakLitPct.toFixed(2)}%`
  }
}

function checkLoop(envelope: Envelope): GateRuleResult {
  const passed = envelope.loopMeanDiff <= LOOP_MEAN_DIFF_LIMIT
  return {
    rule: 'loop-closure',
    passed,
    detail: `first<->last frame mean abs diff ${envelope.loopMeanDiff.toFixed(3)}/255 vs limit ${LOOP_MEAN_DIFF_LIMIT}`
  }
}

function checkMotion(envelope: Envelope): GateRuleResult {
  const passed = envelope.motionMeanDiff >= MOTION_MIN_MEAN_DIFF
  return {
    rule: 'motion-present',
    passed,
    detail: `mean consecutive-frame abs diff ${envelope.motionMeanDiff.toFixed(3)}/255 vs min ${MOTION_MIN_MEAN_DIFF}`
  }
}

export async function runGate(videoPath: string, expectations: GateExpectations): Promise<GateReport> {
  const { facts, envelope } = await measureEnvelope(videoPath)
  const rules: GateRuleResult[] = [
    checkSpec(facts, expectations),
    checkBackground(envelope),
    checkCoverage(envelope),
    checkSymmetry(envelope),
    checkBreathing(envelope),
    checkLoop(envelope),
    checkMotion(envelope)
  ]
  return {
    file: videoPath,
    passed: rules.every((r) => r.passed),
    facts: {
      width: facts.width,
      height: facts.height,
      fps: facts.fps,
      durationSeconds: facts.durationSeconds,
      frameCount: facts.frameCount,
      codec: facts.codec,
      pixFmt: facts.pixFmt,
      audioStreamCount: facts.audioStreamCount
    },
    rules
  }
}
