import type { BoardModel, Footprint, Text, Vec2 } from '@silk-reel/ingest'
import type { Rng } from './rng'
import { simplifyStrokes } from './simplify'
import type { CastHints, Glyph, GlyphLabel, TimelineWarning } from './types'

const MIN_STROKES = 1
/** after simplifying, more than this reads as noise at hairline width */
const MAX_STROKES = 20
const MAX_POINTS = 900
/** the cast is small on purpose — formations repeat heroes for rhythm */
const MAX_PACKAGE_GLYPHS = 8
const MAX_TEXT_GLYPHS = 4
/** embedded labels this far outside the outline's unit box would collide with neighbours */
const LABEL_RADIUS_LIMIT = 1.3
const LABEL_HEIGHT = 0.2
/** JetBrains Mono advance, in em */
const MONO_ADVANCE = 0.6

function bboxOf(strokes: Vec2[][]): { min: Vec2; max: Vec2 } {
  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  for (const s of strokes) {
    for (const p of s) {
      if (p.x < min.x) min.x = p.x
      if (p.y < min.y) min.y = p.y
      if (p.x > max.x) max.x = p.x
      if (p.y > max.y) max.y = p.y
    }
  }
  return { min, max }
}

/** center strokes at origin and scale so the larger dimension spans 1 */
function normalize(strokes: Vec2[][]): { strokes: Vec2[][]; cx: number; cy: number; span: number } | undefined {
  const { min, max } = bboxOf(strokes)
  const w = max.x - min.x
  const h = max.y - min.y
  const span = Math.max(w, h)
  if (!(span > 0.2)) return undefined
  const cx = (min.x + max.x) / 2
  const cy = (min.y + max.y) / 2
  return {
    strokes: strokes.map((s) => s.map((p) => ({ x: (p.x - cx) / span, y: (p.y - cy) / span }))),
    cx,
    cy,
    span
  }
}

const isClosed = (s: Vec2[]): boolean => {
  const a = s[0]
  const b = s[s.length - 1]
  return a !== undefined && b !== undefined && dist(a, b) < 0.02
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

const strokeLen = (s: Vec2[]): number => {
  let n = 0
  for (let i = 1; i < s.length; i++) n += dist(s[i - 1] as Vec2, s[i] as Vec2)
  return n
}

/** largest closed stroke, or undefined — the package "body" a hero needs */
function bodyStroke(strokes: Vec2[][]): Vec2[] | undefined {
  let best: Vec2[] | undefined
  let bestArea = 0
  for (const s of strokes) {
    if (!isClosed(s)) continue
    const { min, max } = bboxOf([s])
    const area = (max.x - min.x) * (max.y - min.y)
    if (area > bestArea) {
      bestArea = area
      best = s
    }
  }
  return best
}

/**
 * pin-1 marker: a chamfered corner on the body (a short diagonal edge near a
 * bbox corner), or a small stray stroke parked at a corner — the notch that
 * makes a silhouette read as a real package.
 */
function hasPin1(strokes: Vec2[][], body: Vec2[]): boolean {
  const { min, max } = bboxOf(strokes)
  const corners = [
    { x: min.x, y: min.y },
    { x: max.x, y: min.y },
    { x: max.x, y: max.y },
    { x: min.x, y: max.y }
  ]
  const nearCorner = (p: Vec2, r: number): boolean =>
    corners.some((c) => Math.abs(p.x - c.x) < r && Math.abs(p.y - c.y) < r)
  // chamfer: a diagonal body edge (slope ~±1) whose midpoint sits at a corner
  for (let i = 1; i < body.length; i++) {
    const a = body[i - 1] as Vec2
    const b = body[i] as Vec2
    const len = dist(a, b)
    if (len < 0.03 || len > 0.4) continue
    const slope = Math.abs((b.y - a.y) / Math.max(1e-9, b.x - a.x))
    if (Math.abs(slope - 1) > 0.35) continue
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (nearCorner(mid, 0.3)) return true
  }
  // or a detached tick (< 0.15 span) within 0.25 span of a corner
  for (const s of strokes) {
    if (s === body) continue
    if (strokeLen(s) > 0.15) continue
    if (s.some((p) => nearCorner(p, 0.25))) return true
  }
  return false
}

interface PackageCandidate {
  ref: string
  fp: Footprint
  strokes: Vec2[][]
  label: GlyphLabel | undefined
  score: number
}

function packageCandidates(board: BoardModel): PackageCandidate[] {
  const lineById = new Map<string, Vec2[]>()
  const textById = new Map<string, Text>()
  for (const layer of Object.values(board.silkscreen)) {
    for (const line of layer.lines) lineById.set(line.id, line.points)
    for (const text of layer.texts) textById.set(text.id, text)
  }
  const out: PackageCandidate[] = []
  for (const fp of board.footprints) {
    const raw: Vec2[][] = []
    const texts: Text[] = []
    for (const ref of fp.silkRefs) {
      const line = lineById.get(ref)
      if (line !== undefined && line.length >= 2) {
        raw.push(line)
        continue
      }
      const text = textById.get(ref)
      if (text !== undefined) texts.push(text)
    }
    if (raw.length < MIN_STROKES) continue
    const silkBox = bboxOf(raw)
    const silkSpan = Math.max(1e-6, Math.max(silkBox.max.x - silkBox.min.x, silkBox.max.y - silkBox.min.y))
    // silk only — pads turned connectors into pin-field noise; the simplified
    // outline is the readable silhouette
    const strokes = simplifyStrokes(raw, silkSpan)
    if (strokes.length < MIN_STROKES || strokes.length > MAX_STROKES) continue
    const points = strokes.reduce((n, s) => n + s.length, 0)
    if (points > MAX_POINTS) continue
    const normalized = normalize(strokes)
    if (normalized === undefined) continue
    const body = bodyStroke(normalized.strokes)
    const bodyBox = body === undefined ? undefined : bboxOf([body])
    const innerW = bodyBox === undefined ? 0 : bodyBox.max.x - bodyBox.min.x

    // at most one embedded label, and only when the word fits inside the body
    // (0.6em advance × label height vs 60% of the inner body width)
    const fits = (value: string): boolean => value.length * MONO_ADVANCE * LABEL_HEIGHT <= 0.6 * innerW
    let label: GlyphLabel | undefined
    for (const t of texts) {
      const value = t.value.trim().replace(/\s*\n\s*/g, ' ')
      if (value.length < 1 || value.length > 16 || !fits(value)) continue
      const lx = (t.pos.x - normalized.cx) / normalized.span
      const ly = (t.pos.y - normalized.cy) / normalized.span
      if (Math.hypot(lx, ly) > LABEL_RADIUS_LIMIT) continue
      label = { text: value, x: lx, y: ly, size: LABEL_HEIGHT, rot: (t.rot * Math.PI) / 180 }
      break
    }
    // refdes inside the outline — the assembly-drawing look
    if (label === undefined && /^[A-Z]{1,4}\d+[A-Z]?$/.test(fp.ref) && fits(fp.ref)) {
      label = { text: fp.ref, x: 0, y: 0, size: LABEL_HEIGHT, rot: 0 }
    }

    const ns = normalized.strokes
    const { min, max } = bboxOf(ns)
    const glyphArea = Math.max(1e-9, (max.x - min.x) * (max.y - min.y))
    const closedBody = body !== undefined && bodyBox !== undefined
      && ((bodyBox.max.x - bodyBox.min.x) * (bodyBox.max.y - bodyBox.min.y)) / glyphArea >= 0.6
    const w = Math.max(1e-9, max.x - min.x)
    const h = Math.max(1e-9, max.y - min.y)
    const score =
      (closedBody ? 3 : 0) +
      (body !== undefined && hasPin1(ns, body) ? 2 : 0) +
      (Math.abs(Math.log(w / h)) > 0.25 ? 1 : 0) -
      Math.max(0, ns.length - 6) * 0.5 +
      (label === undefined ? 0 : 0.3)
    out.push({ ref: fp.ref, fp, strokes: normalized.strokes, label, score })
  }
  return out
}

/** refdes ("R12"), raw values ("4.7uF") and single glyphs are noise — the
 *  legible cast is real words: logos, names, warnings */
export const REFDES = /^[A-Z]{1,3}\d+$/
export const VALUE = /^\d+(\.\d+)?[pnuµmkKM]?[FHΩR]?$/
/** texts smaller than this on the front layer never survive the stage scale */
const FRONT_TEXT_MM = 0.8

interface TextCandidate {
  value: string
  /** on F.SilkS and tall enough to read at formation scale */
  front: boolean
}

function textCandidates(board: BoardModel): TextCandidate[] {
  const seen = new Set<string>()
  const out: TextCandidate[] = []
  for (const [layerId, layer] of Object.entries(board.silkscreen)) {
    const front = layerId.startsWith('F.')
    for (const t of layer.texts) {
      const v = t.value.trim().replace(/\s*\n\s*/g, ' ')
      if (v.length < 2 || v.length > 16 || seen.has(v)) continue
      if (!/[A-Za-z0-9]/.test(v)) continue
      if (REFDES.test(v) || VALUE.test(v)) continue
      seen.add(v)
      out.push({ value: v, front: front && t.height >= FRONT_TEXT_MM })
    }
  }
  return out
}

const circle = (r: number, n = 20): Vec2[] => {
  const pts: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return pts
}

/** synthesized small marks standing in for artifacts the board doesn't carry */
function markGlyphs(): Glyph[] {
  const crossH = [
    { x: -0.62, y: 0 },
    { x: 0.62, y: 0 }
  ]
  const crossV = [
    { x: 0, y: -0.62 },
    { x: 0, y: 0.62 }
  ]
  /** corner bracket — the reference's framing ornament */
  const bracket = [
    { x: -0.6, y: 0.15 },
    { x: -0.15, y: -0.6 }
  ]
  /** four-point sparkle */
  const sparkle = [
    { x: 0, y: -0.65 },
    { x: 0.14, y: -0.14 },
    { x: 0.65, y: 0 },
    { x: 0.14, y: 0.14 },
    { x: 0, y: 0.65 },
    { x: -0.14, y: 0.14 },
    { x: -0.65, y: 0 },
    { x: -0.14, y: -0.14 },
    { x: 0, y: -0.65 }
  ]
  const dash = [
    { x: -0.55, y: 0 },
    { x: 0.55, y: 0 }
  ]
  return [
    { id: 'mark:dot', kind: 'mark', strokes: [circle(0.15)], filled: true },
    { id: 'mark:dash', kind: 'mark', strokes: [dash] },
    { id: 'mark:plus', kind: 'mark', strokes: [crossH, crossV] },
    { id: 'mark:bracket', kind: 'mark', strokes: [bracket] },
    { id: 'mark:sparkle', kind: 'mark', strokes: [sparkle] }
  ]
}

/**
 * marks that exist because this board has them — fiducials, mounting holes,
 * test points, via pairs. Ranked ahead of the synthetic set so the ornaments
 * stay true to the board.
 */
function boardMarks(board: BoardModel): Glyph[] {
  const out: Glyph[] = []
  let fiducial = false
  let mount = false
  let tp = false
  const lineById = new Map<string, Vec2[]>()
  for (const layer of Object.values(board.silkscreen)) {
    for (const line of layer.lines) lineById.set(line.id, line.points)
  }
  for (const fp of board.footprints) {
    if (/^FID/i.test(fp.ref) || /fiducial/i.test(fp.value ?? '')) fiducial = true
    else if (/^(H|MH|MK)\d+/.test(fp.ref) || /mounting[\s_-]*hole/i.test(fp.value ?? '')) mount = true
    else if (/^TP\d+/.test(fp.ref)) tp = true
    else if (/logo/i.test(fp.ref) || /logo/i.test(fp.value ?? '')) {
      // logos keep their real artwork
      const strokes = fp.silkRefs
        .map((r) => lineById.get(r))
        .filter((pts): pts is Vec2[] => pts !== undefined && pts.length >= 2)
      if (strokes.length < 1) continue
      const b = bboxOf(strokes)
      const simplified = simplifyStrokes(strokes, Math.max(1e-6, Math.max(b.max.x - b.min.x, b.max.y - b.min.y)))
      const normalized = normalize(simplified)
      if (normalized !== undefined) {
        out.push({ id: `bmark:${fp.ref}`, kind: 'mark', strokes: normalized.strokes })
      }
    }
  }
  if (board.drill.some((d) => !d.plated && d.dia >= 2)) mount = true
  // via pairs within 1.5mm read as a colon
  let vias = false
  const viaPts: Vec2[] = []
  for (const layers of Object.values(board.copper)) for (const v of layers.vias) viaPts.push(v.pos)
  outer: for (let i = 0; i < viaPts.length; i++) {
    for (let j = i + 1; j < viaPts.length; j++) {
      if (dist(viaPts[i] as Vec2, viaPts[j] as Vec2) < 1.5) {
        vias = true
        break outer
      }
    }
  }
  // board-derived icons lead the mark bench
  const derived: Glyph[] = []
  if (fiducial) {
    derived.push({ id: 'bmark:fiducial', kind: 'mark', strokes: [circle(0.4), [
      { x: -0.62, y: 0 },
      { x: 0.62, y: 0 }
    ], [
      { x: 0, y: -0.62 },
      { x: 0, y: 0.62 }
    ]] })
  }
  if (mount) derived.push({ id: 'bmark:mount', kind: 'mark', strokes: [circle(0.45)] })
  if (tp) derived.push({ id: 'bmark:tp', kind: 'mark', strokes: [circle(0.12)], filled: true })
  if (vias) {
    derived.push({ id: 'bmark:vias', kind: 'mark', strokes: [
      circle(0.14).map((p) => ({ x: p.x, y: p.y - 0.3 })),
      circle(0.14).map((p) => ({ x: p.x, y: p.y + 0.3 }))
    ] })
  }
  return [...derived, ...out]
}

export interface CastResult {
  cast: Glyph[]
  warnings: TimelineWarning[]
  /** refs of footprints whose outlines made the cast — ghost heroes */
  heroRefs: Set<string>
}

export function buildCast(
  board: BoardModel,
  textsEnabled: boolean,
  rng: Rng,
  hints?: CastHints
): CastResult {
  const warnings: TimelineWarning[] = []
  const cast: Glyph[] = []

  const packageCount = Math.min(MAX_PACKAGE_GLYPHS, 7)
  const candidates = packageCandidates(board)
  const prefer = new Set(hints?.preferRefs ?? [])
  const preferred = candidates.filter((c) => prefer.has(c.ref))
  const missed = [...prefer].filter((ref) => preferred.every((c) => c.ref !== ref))
  for (const ref of missed) {
    warnings.push({ code: 'cast-hint-miss', message: `cast.preferRefs: no usable outline for footprint ${ref}` })
  }
  // hints lead, then silhouette score; ties shuffle so seeds still vary the bench
  const ranked = [
    ...preferred.sort((a, b) => (hints?.preferRefs ?? []).indexOf(a.ref) - (hints?.preferRefs ?? []).indexOf(b.ref)),
    ...rng
      .shuffle(candidates.filter((c) => !prefer.has(c.ref)))
      .sort((a, b) => b.score - a.score)
  ]
  const heroRefs = new Set<string>()
  for (const c of ranked.slice(0, packageCount)) {
    cast.push({ id: `pkg:${c.ref}`, kind: 'package', strokes: c.strokes, labels: c.label === undefined ? [] : [c.label] })
    heroRefs.add(c.ref)
  }
  if (cast.length < 4) {
    warnings.push({
      code: 'thin-cast',
      message: `board exposes only ${cast.length} usable footprint outline(s); marks carry the film`
    })
  }

  if (textsEnabled) {
    const all = textCandidates(board)
    const wanted = new Set(hints?.preferTexts ?? [])
    const hinted = all.filter((c) => wanted.has(c.value))
    for (const v of wanted) {
      if (!hinted.some((c) => c.value === v)) {
        warnings.push({ code: 'cast-hint-miss', message: `cast.preferTexts: no silkscreen text ${JSON.stringify(v)}` })
      }
    }
    const textCount = Math.min(MAX_TEXT_GLYPHS, 3)
    // hinted lead, then front-silk text tall enough to read, then the rest
    const rest = rng.shuffle(all.filter((c) => !wanted.has(c.value)))
    const picked = [
      ...hinted,
      ...rest.filter((c) => c.front),
      ...rest.filter((c) => !c.front)
    ].slice(0, textCount)
    for (const [i, c] of picked.entries()) {
      cast.push({ id: `txt:${i}:${c.value}`, kind: 'text', strokes: [], text: c.value })
    }
  }

  cast.push(...boardMarks(board), ...markGlyphs())
  return { cast, warnings, heroRefs }
}
