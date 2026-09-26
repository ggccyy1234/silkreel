import type { BoardModel, Pad, Text, Vec2 } from '@silk-reel/ingest'
import type { Rng } from './rng'
import type { CastHints, Glyph, GlyphLabel, TimelineWarning } from './types'

const MIN_STROKES = 2
/** detailed connectors are heroes; silkscreen artwork above this is noise */
const MAX_STROKES = 80
const MAX_POINTS = 900
/** pads past this make pin-fields, not readable heroes — silk carries them */
const MAX_PAD_STROKES = 40
/** the cast is small on purpose — formations repeat heroes for rhythm */
const MAX_PACKAGE_GLYPHS = 14
const MAX_TEXT_GLYPHS = 8
/** embedded labels this far outside the outline's unit box would collide with neighbours */
const LABEL_RADIUS_LIMIT = 1.3
const LABEL_HEIGHT = 0.2

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

function closedRatio(strokes: Vec2[][]): number {
  let closed = 0
  for (const s of strokes) {
    const a = s[0]
    const b = s[s.length - 1]
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 0.02) closed += 1
  }
  return strokes.length === 0 ? 0 : closed / strokes.length
}

/** pad shape → outline poly in board coords — pins inside a connector
 *  outline are what make a hero read as hardware, not a plain box */
function padOutline(p: Pad): Vec2[] {
  const hx = p.size.x / 2
  const hy = p.size.y / 2
  let pts: Vec2[]
  if (p.shape === 'circle' || p.shape === 'oval') {
    pts = []
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2
      pts.push({ x: Math.cos(a) * hx, y: Math.sin(a) * hy })
    }
  } else {
    pts = [
      { x: -hx, y: -hy },
      { x: hx, y: -hy },
      { x: hx, y: hy },
      { x: -hx, y: hy },
      { x: -hx, y: -hy }
    ]
  }
  const c = Math.cos(p.rot)
  const s = Math.sin(p.rot)
  return pts.map((pt) => ({ x: p.pos.x + pt.x * c - pt.y * s, y: p.pos.y + pt.x * s + pt.y * c }))
}

interface PackageCandidate {
  ref: string
  strokes: Vec2[][]
  labels: GlyphLabel[]
  score: number
}

function packageCandidates(board: BoardModel): PackageCandidate[] {
  const lineById = new Map<string, Vec2[]>()
  const textById = new Map<string, Text>()
  for (const layer of Object.values(board.silkscreen)) {
    for (const line of layer.lines) lineById.set(line.id, line.points)
    for (const text of layer.texts) textById.set(text.id, text)
  }
  // pads repeat across copper layers (thru-hole sits on both sides) — one id each
  const padById = new Map<string, Pad>()
  for (const layers of Object.values(board.copper)) {
    for (const pad of layers.pads) padById.set(pad.id, pad)
  }
  const out: PackageCandidate[] = []
  for (const fp of board.footprints) {
    const strokes: Vec2[][] = []
    const texts: Text[] = []
    for (const ref of fp.silkRefs) {
      const line = lineById.get(ref)
      if (line !== undefined && line.length >= 2) {
        strokes.push(line)
        continue
      }
      const text = textById.get(ref)
      if (text !== undefined) texts.push(text)
    }
    if (strokes.length < MIN_STROKES || strokes.length > MAX_STROKES) continue
    const silkBox = bboxOf(strokes)
    const silkSpan = Math.max(silkBox.max.x - silkBox.min.x, silkBox.max.y - silkBox.min.y)
    // pin outlines inside the silk boundary — mounting holes and off-body
    // pads stay out, fine-pitch fields (>40 pads) render as mush anyway
    const padOutlines: Vec2[][] = []
    if (fp.padRefs.length <= MAX_PAD_STROKES) {
      const margin = silkSpan * 0.15
      for (const ref of fp.padRefs) {
        const pad = padById.get(ref)
        if (pad === undefined || Math.max(pad.size.x, pad.size.y) > silkSpan * 0.4) continue
        if (
          pad.pos.x < silkBox.min.x - margin ||
          pad.pos.x > silkBox.max.x + margin ||
          pad.pos.y < silkBox.min.y - margin ||
          pad.pos.y > silkBox.max.y + margin
        ) continue
        padOutlines.push(padOutline(pad))
      }
    }
    const all = [...strokes, ...padOutlines]
    const points = all.reduce((n, s) => n + s.length, 0)
    if (points > MAX_POINTS) continue
    const normalized = normalize(all)
    if (normalized === undefined) continue
    // the footprint's own silkscreen text rides inside the outline —
    // the reference's "CREATION in the connector" look
    const labels: GlyphLabel[] = []
    for (const t of texts) {
      const value = t.value.trim().replace(/\s*\n\s*/g, ' ')
      if (value.length < 1 || value.length > 16) continue
      const lx = (t.pos.x - normalized.cx) / normalized.span
      const ly = (t.pos.y - normalized.cy) / normalized.span
      if (Math.hypot(lx, ly) > LABEL_RADIUS_LIMIT) continue
      labels.push({ text: value, x: lx, y: ly, size: LABEL_HEIGHT, rot: (t.rot * Math.PI) / 180 })
      if (labels.length >= 2) break
    }
    // silk labels are rare (refdes texts hide or sit on Fab layers) — fall back
    // to the refdes inside the outline, the assembly-drawing look
    if (labels.length === 0 && /^[A-Z]{1,4}\d+[A-Z]?$/.test(fp.ref)) {
      labels.push({ text: fp.ref, x: 0, y: 0, size: LABEL_HEIGHT, rot: 0 })
    }
    const score =
      closedRatio(normalized.strokes) * 3 +
      Math.min(strokes.length, 40) * 0.4 +
      Math.min(padOutlines.length, 24) * 0.25 +
      labels.length * 0.5
    out.push({ ref: fp.ref, strokes: normalized.strokes, labels, score })
  }
  return out
}

/** refdes ("R12"), raw values ("4.7uF") and single glyphs are noise — the
 *  legible cast is real words: logos, names, warnings */
const REFDES = /^[A-Z]{1,3}\d+$/
const VALUE = /^\d+(\.\d+)?[pnuµmkKM]?[FHΩR]?$/
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

/** synthesized small marks standing in for drills, fiducials and pad artifacts */
function markGlyphs(): Glyph[] {
  const circle: Vec2[] = []
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI * 2
    circle.push({ x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 })
  }
  const cross = [
    { x: -0.62, y: 0 },
    { x: 0.62, y: 0 }
  ]
  const crossV = [
    { x: 0, y: -0.62 },
    { x: 0, y: 0.62 }
  ]
  const diamond = [
    { x: 0, y: -0.55 },
    { x: 0.55, y: 0 },
    { x: 0, y: 0.55 },
    { x: -0.55, y: 0 },
    { x: 0, y: -0.55 }
  ]
  const square = [
    { x: -0.5, y: -0.5 },
    { x: 0.5, y: -0.5 },
    { x: 0.5, y: 0.5 },
    { x: -0.5, y: 0.5 },
    { x: -0.5, y: -0.5 }
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
    { id: 'mark:target', kind: 'mark', strokes: [circle, cross, crossV] },
    {
      id: 'mark:square',
      kind: 'mark',
      strokes: [square, circle.map((p) => ({ x: p.x * 0.4, y: p.y * 0.4 }))]
    },
    { id: 'mark:dot', kind: 'mark', strokes: [circle.map((p) => ({ x: p.x * 0.3, y: p.y * 0.3 }))] },
    { id: 'mark:cross', kind: 'mark', strokes: [cross, crossV] },
    { id: 'mark:diamond', kind: 'mark', strokes: [diamond, square.map((p) => ({ x: p.x * 0.45, y: p.y * 0.45 }))] },
    { id: 'mark:bracket', kind: 'mark', strokes: [bracket] },
    { id: 'mark:sparkle', kind: 'mark', strokes: [sparkle] },
    { id: 'mark:dash', kind: 'mark', strokes: [dash] }
  ]
}

/** fiducial/logo footprints carry silk artwork — extra marks when the board has them */
function boardMarks(board: BoardModel): Glyph[] {
  const lineById = new Map<string, Vec2[]>()
  for (const layer of Object.values(board.silkscreen)) {
    for (const line of layer.lines) lineById.set(line.id, line.points)
  }
  const out: Glyph[] = []
  for (const fp of board.footprints) {
    if (!/fiducial|logo|ref\*|target/i.test(fp.ref)) continue
    const strokes = fp.silkRefs
      .map((r) => lineById.get(r))
      .filter((pts): pts is Vec2[] => pts !== undefined && pts.length >= 2)
    if (strokes.length < 1 || strokes.length > MAX_STROKES) continue
    const normalized = normalize(strokes)
    if (normalized === undefined) continue
    out.push({ id: `bmark:${fp.ref}`, kind: 'mark', strokes: normalized.strokes })
    if (out.length >= 4) break
  }
  return out
}

export interface CastResult {
  cast: Glyph[]
  warnings: TimelineWarning[]
}

export function buildCast(
  board: BoardModel,
  density: number,
  textsEnabled: boolean,
  rng: Rng,
  hints?: CastHints
): CastResult {
  const warnings: TimelineWarning[] = []
  const cast: Glyph[] = []

  const packageCount = Math.max(6, Math.round(10 * density))
  const candidates = packageCandidates(board)
  const prefer = new Set(hints?.preferRefs ?? [])
  const preferred = candidates.filter((c) => prefer.has(c.ref))
  const missed = [...prefer].filter((ref) => preferred.every((c) => c.ref !== ref))
  for (const ref of missed) {
    warnings.push({ code: 'cast-hint-miss', message: `cast.preferRefs: no usable outline for footprint ${ref}` })
  }
  // hints lead, then detail score; ties shuffle so seeds still vary the bench
  const ranked = [
    ...preferred.sort((a, b) => (hints?.preferRefs ?? []).indexOf(a.ref) - (hints?.preferRefs ?? []).indexOf(b.ref)),
    ...rng
      .shuffle(candidates.filter((c) => !prefer.has(c.ref)))
      .sort((a, b) => b.score - a.score)
  ]
  for (const c of ranked.slice(0, Math.min(packageCount, MAX_PACKAGE_GLYPHS))) {
    cast.push({ id: `pkg:${c.ref}`, kind: 'package', strokes: c.strokes, labels: c.labels })
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
    const textCount = Math.min(MAX_TEXT_GLYPHS, Math.max(2, Math.round(6 * density)))
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
  return { cast, warnings }
}
