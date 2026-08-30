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
  }
  rules: GateRuleResult[]
}

export interface GateExpectations {
  width: number
  height: number
  fps: number
  totalFrames: number
}

const BG_LIMIT = 8
const LIT_THRESHOLD = 22
const CODA_WINDOW_FRAMES = 12
const CODA_MIN_LIT_PCT = 0.05
const CODA_MIN_STABLE_FRAMES = 3
const CODA_MAX_PEAK_RATIO = 0.6
const CODA_MIN_MIRROR_RATIO = 0.9
const CODA_MAX_QUADRANT_DEVIATION = 0.15
const DENSITY_MIN_PEAK_PCT = 0.45
const DENSITY_MAX_PEAK_PCT = 0.9

interface Envelope {
  stats: FrameStats[]
  peakLitPct: number
  maximaCount: number
  minLitPct: number
  bestMirrorRatio: number
  worstQuadDeviationAtHighMirror: number
  bgMeanMax: number
}

async function measureEnvelope(videoPath: string): Promise<{ facts: Awaited<ReturnType<typeof probeVideo>>; envelope: Envelope }> {
  const facts = await probeVideo(videoPath)
  const stride = 1
  const stats: FrameStats[] = []
  for await (const frame of decodeGrayFrames(videoPath, { width: facts.width, height: facts.height }, { everyNthFrame: stride })) {
    stats.push(analyzeFrame(frame, { litThreshold: LIT_THRESHOLD }))
  }
  if (stats.length === 0) {
    throw new Error(`no frames decoded from ${videoPath}`)
  }

  const litSeries = stats.map((s) => s.litPct)
  const peakLitPct = Math.max(...litSeries)
  const minLitPct = Math.min(...litSeries)

  let maximaCount = 0
  for (let i = 1; i < litSeries.length - 1; i++) {
    const prev = litSeries[i - 1] as number
    const cur = litSeries[i] as number
    const next = litSeries[i + 1] as number
    if (cur > prev && cur >= next && cur > peakLitPct * 0.3) maximaCount += 1
  }

  const substantialFloor = peakLitPct * 0.25
  const symmetricFrames = stats.filter((s) => s.litPct >= substantialFloor)
  const bestMirrorRatio = symmetricFrames.length > 0 ? Math.max(...symmetricFrames.map((s) => s.mirrorRatio)) : 0
  const balancedCandidates = symmetricFrames.filter((s) => s.mirrorRatio >= 0.95)
  const worstQuadDeviationAtHighMirror =
    balancedCandidates.length > 0 ? Math.max(...balancedCandidates.map((s) => s.quadrantDeviation)) : 1

  return {
    facts,
    envelope: {
      stats,
      peakLitPct,
      maximaCount,
      minLitPct,
      bestMirrorRatio,
      worstQuadDeviationAtHighMirror,
      bgMeanMax: Math.max(...stats.map((s) => s.bgMeanBrightness))
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
    facts.pixFmt === 'yuv420p'
  const parts: string[] = []
  if (facts.width !== expect.width || facts.height !== expect.height) {
    parts.push(`resolution ${facts.width}x${facts.height} != ${expect.width}x${expect.height}`)
  }
  if (!fpsOk) parts.push(`fps ${facts.fps} != ${expect.fps}`)
  if (!frameCountOk) parts.push(`frameCount ${String(facts.frameCount)} != ${expect.totalFrames}`)
  if (!durationOk) parts.push(`duration ${facts.durationSeconds.toFixed(3)}s != ${expectedDuration.toFixed(3)}s`)
  if (facts.codec !== 'h264') parts.push(`codec ${String(facts.codec)} != h264`)
  if (facts.pixFmt !== 'yuv420p') parts.push(`pix_fmt ${String(facts.pixFmt)} != yuv420p`)
  return {
    rule: 'spec-exact',
    passed: specOk,
    detail: specOk
      ? `${facts.width}x${facts.height}@${facts.fps.toFixed(2)}, ${facts.codec}/${facts.pixFmt}, ${facts.durationSeconds.toFixed(3)}s`
      : parts.join('; ')
  }
}

function checkBackground(envelope: Envelope): GateRuleResult {
  const passed = envelope.bgMeanMax <= BG_LIMIT
  return {
    rule: 'background-dark',
    passed,
    detail: `max background mean ${envelope.bgMeanMax.toFixed(2)}/255 vs limit ${BG_LIMIT}`
  }
}

function checkEnvelopeShape(envelope: Envelope): GateRuleResult {
  const hasStructure = envelope.maximaCount >= 2
  const hasReset = envelope.minLitPct < Math.max(0.3, envelope.peakLitPct * 0.05)
  const peakInRange = envelope.peakLitPct >= DENSITY_MIN_PEAK_PCT && envelope.peakLitPct <= DENSITY_MAX_PEAK_PCT
  const passed = hasStructure && hasReset && peakInRange
  return {
    rule: 'density-envelope',
    passed,
    detail: `local maxima=${envelope.maximaCount}, min lit%=${envelope.minLitPct.toFixed(3)}, peak=${envelope.peakLitPct.toFixed(3)} within ${DENSITY_MIN_PEAK_PCT.toFixed(2)}-${DENSITY_MAX_PEAK_PCT.toFixed(2)}`
  }
}

function checkCoda(envelope: Envelope): GateRuleResult {
  const final = envelope.stats.at(-1)
  const tail = envelope.stats.slice(-CODA_WINDOW_FRAMES, -1)
  const nonBlackTail = tail.filter((stat) => stat.litPct > CODA_MIN_LIT_PCT)
  const tailPeak = Math.max(...nonBlackTail.map((stat) => stat.litPct), 0)
  const stableFrames = nonBlackTail.filter(
    (stat) => stat.mirrorRatio >= CODA_MIN_MIRROR_RATIO && stat.quadrantDeviation <= CODA_MAX_QUADRANT_DEVIATION
  )
  const allNonBlackFramesAreStable = stableFrames.length === nonBlackTail.length
  const blackCut = (final?.litPct ?? 0) <= 0.005 && (final?.bgMeanBrightness ?? 0) <= BG_LIMIT
  const sparseTail =
    tailPeak > CODA_MIN_LIT_PCT &&
    nonBlackTail.length >= CODA_MIN_STABLE_FRAMES &&
    allNonBlackFramesAreStable &&
    tailPeak < envelope.peakLitPct * CODA_MAX_PEAK_RATIO
  const passed = blackCut && sparseTail
  return {
    rule: 'sparse-four-pad-tail-black-cut',
    passed,
    detail: `tail peak=${tailPeak.toFixed(3)}, stable tail frames=${stableFrames.length}/${nonBlackTail.length}, final lit%=${(final?.litPct ?? 0).toFixed(3)}, black cut=${blackCut}`
  }
}

function checkSymmetry(envelope: Envelope): GateRuleResult {
  const passed = envelope.bestMirrorRatio >= 0.95
  return {
    rule: 'symmetry-phase',
    passed,
    detail: `best mirrorRatio during dense phases=${envelope.bestMirrorRatio.toFixed(3)}`
  }
}

function checkQuadrants(envelope: Envelope): GateRuleResult {
  const passed = envelope.worstQuadDeviationAtHighMirror <= 0.15
  return {
    rule: 'quadrant-balance',
    passed,
    detail: `worst quadrant deviation at mirror>=0.95=${(envelope.worstQuadDeviationAtHighMirror * 100).toFixed(1)}%`
  }
}

export async function runGate(videoPath: string, expectations: GateExpectations): Promise<GateReport> {
  const { facts, envelope } = await measureEnvelope(videoPath)
  const rules: GateRuleResult[] = [
    checkSpec(facts, expectations),
    checkBackground(envelope),
    checkEnvelopeShape(envelope),
    checkCoda(envelope),
    checkSymmetry(envelope),
    checkQuadrants(envelope)
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
      pixFmt: facts.pixFmt
    },
    rules
  }
}
