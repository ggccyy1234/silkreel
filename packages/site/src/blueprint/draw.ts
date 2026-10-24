import glyphData from './newstroke.json'

type Pt = { x: number; y: number }
type Part = { ref: string; value: string; x: number; y: number; w: number; h: number; rot: number; z: number; kind: string; back: boolean; pads: number; pitch: number }
type Layer = { name: string; type: string; t: number; material?: string }
type Pad = [number, number, number, number, number, number, string]
type CopperLayer = { layer: string; traces: [number, ...number[]][]; zones: number[][]; pads: Pad[] }
export type Board = {
  name: string
  title: string | null
  rev: string | null
  company: string | null
  thickness: number
  finish: string | null
  mask: string | null
  stats: { pads: number; traces: number; nets: number }
  stack: Layer[]
  outline: number[][]
  /** x, y, diameter, plated */
  holes: [number, number, number, number][]
  parts: Part[]
  /** traces are [width, x0, y0, x1, y1, ...]; pads are x, y, w, h, rot, round, footprint ref */
  copper: [CopperLayer, ...CopperLayer[]]
  /** x, y, diameter, drill */
  vias: [number, number, number, number][]
}

// ---------- the pen: ISO 128 line weights on a 594 × 420 sheet, in mm ----------
const W = 594
const H = 420
const LW = { thick: 0.6, thin: 0.3, fine: 0.16 }
const CHAIN = 'stroke-dasharray="6 1.2 0.6 1.2"'
const HIDDEN = 'stroke-dasharray="1.6 0.8"'
const f = (n: number) => +n.toFixed(2)
const mm = (n: number) => String(f(n))

class Pen {
  out = ''
  put(s: string) { this.out += s }
  // pathLength=1 lets the plotter draw any solid stroke with one dash; dashed strokes keep their own pattern and fade in
  line(a: Pt, b: Pt, w = LW.thin, extra = '') { this.poly([a, b], w, false, extra) }
  poly(pts: Pt[], w: number, close = false, extra = '') {
    this.put(`<path d="M${pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}${close ? 'Z' : ''}" stroke-width="${w}"${extra ? ' ' + extra : ' pathLength="1"'}/>`)
  }
  circle(c: Pt, r: number, w: number, extra = '') { this.put(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" stroke-width="${w}"${extra ? ' ' + extra : ' pathLength="1"'}/>`) }
  rect(x: number, y: number, w: number, h: number, sw: number, extra = '') { this.put(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" stroke-width="${sw}"${extra ? ' ' + extra : ' pathLength="1"'}/>`) }
  solid(x: number, y: number, w: number, h: number) { if (w > 0 && h > 0) this.put(`<rect class="fill" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/>`) }
  open(attrs: string) { this.put(`<g ${attrs}>`) }
  close() { this.put('</g>') }

  // KiCad's single-stroke lettering (newstroke, CC0), the face every board's silkscreen is printed in
  text(s: string, x: number, y: number, size: number, anchor: 'start' | 'middle' | 'end' = 'start', w = Math.max(0.22, size * 0.1), halo = false) {
    const k = size / 21
    const strokes: Pt[][] = []
    let pen = 0
    for (const ch of s) {
      const g = GLYPHS[ch.codePointAt(0) ?? 32] ?? GLYPHS[32]
      if (!g) continue
      const left = g.charCodeAt(0) - R
      let cur: Pt[] = []
      for (let i = 2; i < g.length; i += 2) {
        if (g[i] === ' ' && g[i + 1] === 'R') { if (cur.length) strokes.push(cur); cur = []; continue }
        cur.push({ x: pen + g.charCodeAt(i) - R - left, y: g.charCodeAt(i + 1) - R })
      }
      if (cur.length) strokes.push(cur)
      pen += g.charCodeAt(1) - R - left
    }
    const dx = anchor === 'start' ? 0 : anchor === 'middle' ? -pen / 2 : -pen
    const d = strokes.map((st) => 'M' + st.map((p) => `${f(x + (p.x + dx) * k)} ${f(y + (p.y + 9) * k)}`).join('L')).join('')
    if (halo) this.put(`<path class="halo" d="${d}" stroke-width="${f(w + size * 0.5)}"/>`)
    this.put(`<path class="t" d="${d}" stroke-width="${f(w)}" pathLength="1"/>`)
    return pen * k
  }

  // ISO 129: extension lines start 1 mm off the part, filled 15° arrows, the value above the line
  arrow(tip: Pt, dir: Pt) {
    const L = 2.6
    const s = Math.tan((7.5 * Math.PI) / 180) * L
    const b = { x: tip.x - dir.x * L, y: tip.y - dir.y * L }
    this.put(`<path class="fill" d="M${f(tip.x)} ${f(tip.y)}L${f(b.x - dir.y * s)} ${f(b.y + dir.x * s)}L${f(b.x + dir.y * s)} ${f(b.y - dir.x * s)}Z"/>`)
  }
  dim(a: Pt, b: Pt, off: number, label: string, size = 3.2) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
    const n = { x: -u.y * Math.sign(off), y: u.x * Math.sign(off) }
    const o = Math.abs(off)
    const at = (p: Pt, t: number) => ({ x: p.x + n.x * t, y: p.y + n.y * t })
    this.line(at(a, 1), at(a, o + 2), LW.fine)
    this.line(at(b, 1), at(b, o + 2), LW.fine)
    const p = at(a, o)
    const q = at(b, o)
    this.line(p, q, LW.fine)
    this.arrow(p, { x: -u.x, y: -u.y })
    this.arrow(q, u)
    const vertical = Math.abs(u.x) < 0.5
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    if (vertical) {
      this.open(`transform="rotate(-90 ${f(m.x)} ${f(m.y)})"`)
      this.text(label, m.x, m.y - size - 1.2, size, 'middle', undefined, true)
      this.close()
    } else this.text(label, m.x, m.y - size - 1.2, size, 'middle', undefined, true)
  }
  centre(c: Pt, r: number) {
    const e = r + 2
    this.line({ x: c.x - e, y: c.y }, { x: c.x + e, y: c.y }, LW.fine, CHAIN)
    this.line({ x: c.x, y: c.y - e }, { x: c.x, y: c.y + e }, LW.fine, CHAIN)
  }
  breakLine(x: number, y0: number, y1: number) {
    const m = (y0 + y1) / 2
    this.poly([{ x, y: y0 - 1.5 }, { x, y: m - 2 }, { x: x - 1.6, y: m - 0.8 }, { x: x + 1.6, y: m + 0.8 }, { x, y: m + 2 }, { x, y: y1 + 1.5 }], LW.fine)
  }
}

const GLYPHS = glyphData as Record<string, string>
// Hershey encoding: every coordinate is a character, offset from 'R'
const R = 82

// lines of the lettering as one standalone SVG, 1em per cap height, so every line scales together
export function lettering(lines: string[], { weight = 0.07, align = 'start', accent = -1 }: { weight?: number; align?: 'start' | 'middle' | 'end'; accent?: number } = {}) {
  const lead = 1.34
  const width = Math.max(...lines.map((l) => new Pen().text(l, 0, 0, 1, 'start', weight)))
  const x = align === 'start' ? 0 : align === 'middle' ? width / 2 : width
  const P = new Pen()
  lines.forEach((l, i) => {
    if (i === accent) P.open('class="lt--accent"')
    P.text(l, x, i * lead, 1, align, weight)
    if (i === accent) P.close()
  })
  const h = (lines.length - 1) * lead + 1
  return `<svg viewBox="${f(-weight)} ${f(-weight)} ${f(width + 2 * weight)} ${f(h + 2 * weight)}" style="width:${f(width + 2 * weight)}em" aria-hidden="true">${P.out.replace(/ pathLength="1"/g, '')}</svg>`
}

// ---------- geometry ----------
function pts(a: number[], from = 0): Pt[] {
  const o: Pt[] = []
  for (let i = from; i + 1 < a.length; i += 2) {
    const x = a[i]
    const y = a[i + 1]
    if (x !== undefined && y !== undefined) o.push({ x, y })
  }
  return o
}
// each edge of a closed polygon, last vertex back to the first included
function* edges(poly: Pt[]): Generator<[Pt, Pt]> {
  let a = poly.at(-1)
  for (const b of poly) {
    if (a) yield [a, b]
    a = b
  }
}
/** a part's body, or any rotated rectangle, as its four corners */
export function boxOf(p: Pick<Part, 'x' | 'y' | 'w' | 'h' | 'rot'>) {
  const a = (-p.rot * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, v]) => {
    const x = (u * p.w) / 2
    const y = (v * p.h) / 2
    return { x: p.x + x * c - y * s, y: p.y + x * s + y * c }
  })
}
// where a convex polygon crosses the horizontal line y = c
function spanOf(poly: Pt[], c: number): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const [a, b] of edges(poly)) {
    if ((a.y <= c && b.y >= c) || (b.y <= c && a.y >= c)) {
      if (a.y === b.y) { lo = Math.min(lo, a.x, b.x); hi = Math.max(hi, a.x, b.x); continue }
      const x = a.x + ((c - a.y) / (b.y - a.y)) * (b.x - a.x)
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
  }
  return lo <= hi ? [lo, hi] : null
}
const chord = (cx: number, cy: number, r: number, c: number): [number, number] | null => {
  const d = c - cy
  if (Math.abs(d) > r) return null
  const h = Math.sqrt(r * r - d * d)
  return [cx - h, cx + h]
}
function capsule(a: Pt, b: Pt, r: number, c: number): [number, number] | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const n = { x: (-(b.y - a.y) / len) * r, y: ((b.x - a.x) / len) * r }
  const spans = [chord(a.x, a.y, r, c), chord(b.x, b.y, r, c), spanOf([{ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y }, { x: b.x - n.x, y: b.y - n.y }, { x: a.x - n.x, y: a.y - n.y }], c)].filter(Boolean) as [number, number][]
  if (!spans.length) return null
  return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))]
}
// even-odd scanline: the inside runs of a polygon set (outline, zone fills) along y = c
function runs(polys: Pt[][], c: number): [number, number][] {
  const xs: number[] = []
  for (const p of polys) for (const [a, b] of edges(p)) if ((a.y <= c) !== (b.y <= c)) xs.push(a.x + ((c - a.y) / (b.y - a.y)) * (b.x - a.x))
  xs.sort((a, b) => a - b)
  const o: [number, number][] = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i]
    const b = xs[i + 1]
    if (a !== undefined && b !== undefined) o.push([a, b])
  }
  return o
}
function padSpan([x, y, w, h, rot, round]: Pad, c: number): [number, number] | null {
  if (round && Math.abs(w - h) < 0.01) return chord(x, y, w / 2, c)
  return spanOf(boxOf({ x, y, w, h, rot }), c)
}
function outlinePolys(b: Board): Pt[][] {
  // the outline arrives as open pieces (lines and arcs); chain them into closed loops for the scanline
  const pieces = b.outline.map((o) => pts(o))
  const loops: Pt[][] = []
  const near = (p: Pt | undefined, q: Pt | undefined) => !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) < 0.02
  for (let loop = pieces.shift(); loop; loop = pieces.shift()) {
    const l = loop
    while (!near(l[0], l.at(-1))) {
      const i = pieces.findIndex((p) => near(p[0], l.at(-1)) || near(p.at(-1), l.at(-1)))
      const [p] = i < 0 ? [] : pieces.splice(i, 1)
      if (!p) break
      l.push(...(near(p[0], l.at(-1)) ? p : p.reverse()).slice(1))
    }
    loops.push(l)
  }
  return loops
}

// ---------- the sheet layout ----------
export interface Layout { plan: { x: number; y: number; s: number; bb: { x0: number; y0: number; x1: number; y1: number } }; hero: Part }
const S1 = 3
const SEC = { x: 322, y: 116, s: 10, half: 7 }
const DET = { x: 404, y: 236, r: 42 }

// where the camera stops on the sheet, as [x, y, w, h] in sheet mm
export function views(b: Board) {
  const { plan } = layout(b)
  const bw = (plan.bb.x1 - plan.bb.x0) * S1
  const bh = (plan.bb.y1 - plan.bb.y0) * S1
  return {
    sheet: [0, 0, W, H],
    plan: [plan.x - 14, plan.y - 44, bw + 58, bh + 110],
    section: [SEC.x - 24, SEC.y - 54, SEC.half * 2 * SEC.s + 92, 108],
    detail: [DET.x - DET.r - 14, DET.y - DET.r - 10, DET.r * 2 + 28, DET.r * 2 + 40],
    title: [W - 15 - 182, H - 15 - 110, 184, 112],
  } satisfies Record<string, [number, number, number, number]>
}

export function layout(b: Board): Layout {
  const all = b.outline.flatMap((o) => pts(o))
  const bb = { x0: Math.min(...all.map((p) => p.x)), y0: Math.min(...all.map((p) => p.y)), x1: Math.max(...all.map((p) => p.x)), y1: Math.max(...all.map((p) => p.y)) }
  const hero = b.parts.reduce((a, p) => (p.pads > a.pads ? p : a))
  return { plan: { x: 40, y: 70, s: S1, bb }, hero }
}

export function sheet(b: Board): string {
  const L = layout(b)
  const { plan, hero } = L
  const { bb } = plan
  const pl = (p: Pt): Pt => ({ x: plan.x + (p.x - bb.x0) * S1, y: plan.y + (p.y - bb.y0) * S1 })
  const bw = (bb.x1 - bb.x0) * S1
  const bh = (bb.y1 - bb.y0) * S1
  const P = new Pen()

  // frame, zones 1-8 and A-F
  P.open('data-plot="frame"')
  P.rect(10, 10, W - 20, H - 20, LW.thick)
  P.rect(15, 15, W - 30, H - 30, LW.thin)
  for (let i = 0; i < 8; i++) {
    const x = 10 + ((W - 20) * i) / 8
    if (i) { P.line({ x, y: 10 }, { x, y: 15 }); P.line({ x, y: H - 15 }, { x, y: H - 10 }) }
    const cx = x + (W - 20) / 16
    P.text(String(i + 1), cx, 11, 2.6, 'middle')
    P.text(String(i + 1), cx, H - 14, 2.6, 'middle')
  }
  for (const [j, zone] of ['A', 'B', 'C', 'D', 'E', 'F'].entries()) {
    const y = 10 + ((H - 20) * j) / 6
    if (j) { P.line({ x: 10, y }, { x: 15, y }); P.line({ x: W - 15, y }, { x: W - 10, y }) }
    const cy = y + (H - 20) / 12 - 1.3
    P.text(zone, 12.5, cy, 2.6, 'middle')
    P.text(zone, W - 12.5, cy, 2.6, 'middle')
  }
  P.close()

  // FIG. 1, the plan: copper first (faint), then bodies, then the outline over everything
  P.open('data-plot="copper" class="cu"')
  for (const t of b.copper[0].traces) P.poly(pts(t, 1).map(pl), Math.max(LW.fine * 0.8, t[0] * S1 * 0.35))
  P.close()
  P.open('data-plot="parts"')
  const parts = [...b.parts].sort((p, q) => p.x - q.x)
  for (const p of parts.filter((q) => q.back)) P.poly(boxOf(p).map(pl), LW.fine, true, HIDDEN)
  for (const p of parts.filter((q) => !q.back)) P.poly(boxOf(p).map(pl), p === hero ? LW.thick : LW.thin, true, 'class="body" pathLength="1"')
  for (const [x, y, w, , , , ref] of b.copper[0].pads) if (ref === hero.ref) P.circle(pl({ x, y }), (w / 2) * S1, LW.fine)
  P.close()
  P.open('data-plot="outline"')
  for (const o of b.outline) P.poly(pts(o).map(pl), LW.thick)
  const holes = b.holes.filter((h) => h[2] > 2)
  for (const h of holes) P.circle(pl({ x: h[0], y: h[1] }), (h[2] / 2) * S1, LW.thick)
  P.close()

  P.open('data-plot="dims"')
  for (const h of holes) P.centre(pl({ x: h[0], y: h[1] }), (h[2] / 2) * S1)
  P.dim({ x: plan.x, y: plan.y + bh }, { x: plan.x + bw, y: plan.y + bh }, 14, mm(bb.x1 - bb.x0))
  P.dim({ x: plan.x + bw, y: plan.y }, { x: plan.x + bw, y: plan.y + bh }, -26, mm(bb.y1 - bb.y0))
  const hs = [...holes].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const [a] = hs
  const z = hs.at(-1)
  const [top] = [...holes].sort((p, q) => p[1] - q[1] || p[0] - q[0])
  if (a && z && top && hs.length >= 2) {
    const across = hs.find((h) => Math.abs(h[1] - a[1]) < 0.01 && h !== a)
    if (across) P.dim(pl({ x: a[0], y: a[1] }), pl({ x: across[0], y: across[1] }), -(pl({ x: a[0], y: a[1] }).y - plan.y) - 9, mm(across[0] - a[0]))
    const up = hs.find((h) => Math.abs(h[0] - z[0]) < 0.01 && h !== z)
    if (up) P.dim(pl({ x: up[0], y: up[1] }), pl({ x: z[0], y: z[1] }), -(plan.x + bw - pl({ x: z[0], y: z[1] }).x) - 14, mm(Math.abs(up[1] - z[1])))
    const hc = pl({ x: top[0], y: top[1] })
    const r0 = (top[2] / 2) * S1
    const tip = { x: hc.x + r0 * 0.707, y: hc.y - r0 * 0.707 }
    const knee = { x: tip.x + 14, y: plan.y - 20 }
    P.line(tip, knee, LW.fine)
    P.line(knee, { x: knee.x + 30, y: knee.y }, LW.fine)
    const d = Math.hypot(tip.x - knee.x, tip.y - knee.y)
    P.arrow(tip, { x: (tip.x - knee.x) / d, y: (tip.y - knee.y) / d })
    P.text(`${holes.length}X Ø${mm(top[2])} THRU`, knee.x + 15, knee.y - 4.6, 2.8, 'middle')
  }
  P.close()

  // patent reference numerals on the parts a designer would name, keyed in the parts list
  const named = b.parts.filter((p) => !p.back && ['ic', 'conn', 'xtal', 'switch'].includes(p.kind)).sort((p, q) => q.pads - p.pads).slice(0, 6)
  P.open('data-plot="numerals"')
  const pins = named.map((p, i) => ({ n: String(10 + i * 2), c: pl(p), side: pl(p).y < plan.y + bh * 0.45 ? -1 : 1, tx: 0 }))
  for (const side of [-1, 1]) {
    const row = pins.filter((q) => q.side === side).sort((p, q) => p.c.x - q.c.x)
    let floor = plan.x + 10
    for (const [i, q] of row.entries()) {
      q.tx = Math.max(q.c.x + (i - (row.length - 1) / 2) * 10, floor)
      floor = q.tx + 16
    }
  }
  for (const { c, n, side, tx } of pins) {
    const ty = side < 0 ? plan.y - 36 : plan.y + bh + 30
    P.put(`<path d="M${f(c.x)} ${f(c.y)}C${f(c.x)} ${f(c.y + side * 18)} ${f(tx)} ${f(ty - side * 22)} ${f(tx)} ${f(ty - side * (side < 0 ? 1.4 : 5.8))}" stroke-width="${LW.fine}" pathLength="1"/>`)
    P.put(`<circle class="fill" cx="${f(c.x)}" cy="${f(c.y)}" r="0.45"/>`)
    P.text(n, tx, ty - (side < 0 ? 4.6 : 0), 4.2, 'middle', 0.36)
  }
  P.text('FIG. 1', plan.x + bw / 2, plan.y + bh + 48, 7, 'middle', 0.6)
  P.text('PLAN  3:1', plan.x + bw / 2, plan.y + bh + 57, 3.2, 'middle')
  P.close()

  // FIG. 2, front elevation, third-angle: below the plan, looking at the plan's bottom edge
  const T = b.thickness
  const E0 = plan.y + bh + 96
  const ex = (x: number) => plan.x + (x - bb.x0) * S1
  P.open('data-plot="elevation"')
  for (const p of [...b.parts].sort((p, q) => p.y - q.y)) {
    const xs = boxOf(p).map((q) => q.x)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    P.rect(ex(x0), p.back ? E0 + T * S1 : E0 - p.z * S1, (x1 - x0) * S1, p.z * S1, p === hero ? LW.thick : LW.thin, 'class="body" pathLength="1"')
  }
  P.rect(plan.x, E0, bw, T * S1, LW.thick, 'class="body" pathLength="1"')
  for (const h of holes) P.line({ x: ex(h[0]), y: E0 - 4 }, { x: ex(h[0]), y: E0 + T * S1 + 4 }, LW.fine, CHAIN)
  P.dim({ x: plan.x, y: E0 }, { x: plan.x, y: E0 + T * S1 }, 12, mm(T), 2.8)
  P.text('FIG. 2', plan.x + bw / 2, E0 + 24, 7, 'middle', 0.6)
  P.text('FRONT ELEVATION  3:1', plan.x + bw / 2, E0 + 33, 3.2, 'middle')
  P.close()

  // the live section sits in its own group; the client redraws it as the cut moves
  P.put(`<g data-plot="cut" data-cut>${planCut(b, L, hero.y, hero.x)}</g>`)
  P.put(`<g data-plot="section" data-section>${section(b, L, hero.y, hero.x)}</g>`)

  // DETAIL B: one ball of the hero, 50:1
  P.open('data-plot="detail"')
  detail(P, b, hero)
  P.close()

  // parts list, notes, title block
  P.open('data-plot="blocks"')
  const rowH = 6.4
  const PL = { x: W - 15 - 170, y: H - 15 - 46 - 8 - (named.length + 1) * rowH, w: 170 }
  P.rect(PL.x, PL.y, PL.w, (named.length + 1) * rowH, LW.thick)
  for (let i = 1; i <= named.length; i++) P.line({ x: PL.x, y: PL.y + i * rowH }, { x: PL.x + PL.w, y: PL.y + i * rowH }, i === 1 ? LW.thin : LW.fine)
  for (const x of [18, 44]) P.line({ x: PL.x + x, y: PL.y }, { x: PL.x + x, y: PL.y + (named.length + 1) * rowH })
  P.text('ITEM', PL.x + 3, PL.y + 1.6, 2.4)
  P.text('REF', PL.x + 21, PL.y + 1.6, 2.4)
  P.text('PART', PL.x + 47, PL.y + 1.6, 2.4)
  named.forEach((p, i) => {
    const y = PL.y + (i + 1) * rowH + 1.6
    P.text(String(10 + i * 2), PL.x + 3, y, 2.8)
    P.text(p.ref, PL.x + 21, y, 2.8)
    P.text(p.value.toUpperCase().slice(0, 30), PL.x + 47, y, 2.8)
  })
  const NX = 190
  const NY = 352
  P.text('NOTES', NX, NY, 3.6, 'start', 0.34)
  ;['ALL DIMENSIONS IN MM.', `STACKUP, FINISH AND MASK AS DECLARED IN ${b.name.toUpperCase()}.KICAD_PCB.`, 'HIDDEN LINES: PARTS ON THE BACK.', 'PART HEIGHTS ARE ESTIMATED FROM FOOTPRINTS.']
    .forEach((n, i) => P.text(`${i + 1}. ${n}`, NX, NY + 7 + i * 5.4, 2.6))
  const TB = { x: W - 15 - 170, y: H - 15 - 46, w: 170, h: 46 }
  P.rect(TB.x, TB.y, TB.w, TB.h, LW.thick)
  P.line({ x: TB.x, y: TB.y + 20 }, { x: TB.x + TB.w, y: TB.y + 20 })
  P.line({ x: TB.x, y: TB.y + 33 }, { x: TB.x + TB.w, y: TB.y + 33 })
  for (const x of [60, 100, 135]) P.line({ x: TB.x + x, y: TB.y + 20 }, { x: TB.x + x, y: TB.y + TB.h })
  const name = b.name.toUpperCase()
  const title = (b.title ?? '').toUpperCase()
  P.text(`${name}${title && title !== name ? ' · ' + title : ''}`, TB.x + 4, TB.y + 5, 7, 'start', 0.6)
  P.text(`${b.stats.pads} PADS  ${b.stats.traces} TRACES  ${b.stats.nets} NETS  ${b.copper.length} LAYERS`, TB.x + 4, TB.y + 14.5, 2.6)
  const cell = (x: number, y: number, k: string, v: string) => { P.text(k, TB.x + x + 2, TB.y + y + 1.6, 1.9); P.text(v, TB.x + x + 2, TB.y + y + 6.2, 3.2) }
  cell(0, 20, 'SCALE', '3:1')
  cell(60, 20, 'UNITS', 'MM')
  cell(100, 20, 'REV', b.rev ?? '-')
  cell(135, 20, 'SHEET', '1 / 1')
  cell(0, 33, 'COMPANY', (b.company ?? '-').toUpperCase())
  cell(60, 33, 'FINISH', (b.finish ?? '-').toUpperCase())
  cell(100, 33, 'MASK', (b.mask ?? '-').toUpperCase())
  // third-angle projection symbol (ISO 5456-2)
  const pj = { x: TB.x + 144, y: TB.y + 39.5 }
  P.poly([{ x: pj.x - 6, y: pj.y - 3 }, { x: pj.x - 1, y: pj.y - 4.5 }, { x: pj.x - 1, y: pj.y + 4.5 }, { x: pj.x - 6, y: pj.y + 3 }], LW.thin, true)
  P.circle({ x: pj.x + 7, y: pj.y }, 4.5, LW.thin)
  P.circle({ x: pj.x + 7, y: pj.y }, 2.6, LW.thin)
  P.line({ x: pj.x - 8, y: pj.y }, { x: pj.x + 13, y: pj.y }, LW.fine, CHAIN)
  P.close()

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="bp" role="img" aria-label="A drawing of the ${b.name} board: plan, front elevation, a section through it and a detail of one solder joint">${HATCH}${P.out}</svg>`
}

const HATCH = `<defs>
<pattern id="h-a" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V1.6" stroke-width="${LW.fine}"/></pattern>
<pattern id="h-b" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V1.6" stroke-width="${LW.fine}"/></pattern>
<pattern id="h-ic" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V2.4M1.2 0V2.4" stroke-width="${LW.fine}" stroke-dasharray="3 0.8"/></pattern>
<pattern id="h-ball" width="0.9" height="0.9" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V0.9" stroke-width="${LW.fine}"/></pattern>
</defs>`

// the cutting plane on the plan: chain line, thick ends, view arrows, and the stretch the section shows
export function planCut(b: Board, L: Layout, cy: number, cx: number): string {
  const { plan } = L
  const { bb } = plan
  const P = new Pen()
  const y = plan.y + (cy - bb.y0) * S1
  const x0 = plan.x - 8
  const x1 = plan.x + (bb.x1 - bb.x0) * S1 + 6
  P.line({ x: x0, y }, { x: x1, y }, LW.fine, CHAIN)
  for (const x of [x0, x1]) {
    const k = x === x0 ? 1 : -1
    P.line({ x, y }, { x: x + k * 6, y }, LW.thick + 0.3)
    P.line({ x: x + k * 1.5, y }, { x: x + k * 1.5, y: y + 6 })
    P.arrow({ x: x + k * 1.5, y: y + 8.6 }, { x: 0, y: 1 })
    P.text('A', x + k * 1.5, y - 7, 4.2, 'middle', 0.42)
  }
  const wx0 = plan.x + (cx - SEC.half - bb.x0) * S1
  const wx1 = plan.x + (cx + SEC.half - bb.x0) * S1
  for (const x of [wx0, wx1]) P.line({ x, y: y - 3 }, { x, y: y + 3 }, LW.thick)
  return P.out
}

// SECTION A-A: everything the cutting plane passes through, 10:1, every layer at its declared thickness
export function section(b: Board, L: Layout, cy: number, cx: number): string {
  const P = new Pen()
  const { s, half } = SEC
  const wx0 = cx - half
  const wx1 = cx + half
  const X = (x: number) => SEC.x + (x - wx0) * s
  const Z0 = SEC.y
  const Z = (z: number) => Z0 + z * s
  const clip = ([a, c]: [number, number]): [number, number] | null => { const lo = Math.max(a, wx0); const hi = Math.min(c, wx1); return lo < hi ? [lo, hi] : null }

  const declared = b.stack.filter((l) => l.type === 'copper' || /core|prepreg|mask/i.test(l.type))
  const layers: Layer[] = declared.length ? declared : b.copper.flatMap((c, i) => (i ? [{ name: 'core', type: 'core', t: (b.thickness - 0.035 * b.copper.length) / (b.copper.length - 1) }] : []).concat([{ name: c.layer, type: 'copper', t: 0.035 }]))
  const T = layers.reduce((n, l) => n + l.t, 0)
  const zOf: Record<string, [number, number]> = {}
  {
    let z = 0
    for (const l of layers) { zOf[l.name] = [z, z + l.t]; z += l.t }
  }
  const board = runs(outlinePolys(b), cy).map(clip).filter(Boolean) as [number, number][]

  // dielectric, hatched by layer, then the copper the plane cuts on each layer
  let z = 0
  let k = 0
  for (const l of layers) {
    if (/core|prepreg/.test(l.type)) {
      for (const [a, c] of board) P.rect(X(a), Z(z), (c - a) * s, l.t * s, LW.thin, `fill="url(#h-${k % 2 ? 'b' : 'a'})"`)
      k++
    }
    z += l.t
  }
  const inBoard = (span: [number, number]) => board.some(([a, c]) => span[1] > a && span[0] < c)
  for (const c of b.copper) {
    const zz = zOf[c.layer]
    if (!zz) continue
    const spans: [number, number][] = []
    for (const t of c.traces) {
      let prev: Pt | undefined
      for (const q of pts(t, 1)) {
        const sp = prev && capsule(prev, q, t[0] / 2, cy)
        if (sp) spans.push(sp)
        prev = q
      }
    }
    spans.push(...runs(c.zones.map((zn) => pts(zn)), cy))
    for (const p of c.pads) { const sp = padSpan(p, cy); if (sp) spans.push(sp) }
    for (const v of b.vias) { const sp = chord(v[0], v[1], v[2] / 2, cy); if (sp) spans.push(sp) }
    for (const sp of spans) { const cl = clip(sp); if (cl && inBoard(cl)) P.solid(X(cl[0]), Z(zz[0]), (cl[1] - cl[0]) * s, (zz[1] - zz[0]) * s) }
  }
  // drills: vias are plated barrels, holes are voids
  for (const v of b.vias) {
    const sp = chord(v[0], v[1], v[3] / 2, cy)
    const cl = sp && clip(sp)
    if (!cl) continue
    P.put(`<rect class="void" x="${f(X(cl[0]))}" y="${f(Z(0))}" width="${f((cl[1] - cl[0]) * s)}" height="${f(T * s)}"/>`)
    P.solid(X(cl[0]), Z(0), 0.25, T * s)
    P.solid(X(cl[1]) - 0.25, Z(0), 0.25, T * s)
  }
  for (const h of b.holes) {
    const sp = chord(h[0], h[1], h[2] / 2, cy)
    const cl = sp && clip(sp)
    if (!cl) continue
    P.put(`<rect class="void" x="${f(X(cl[0]))}" y="${f(Z(-0.05))}" width="${f((cl[1] - cl[0]) * s)}" height="${f((T + 0.1) * s)}"/>`)
    P.line({ x: X(cl[0]), y: Z(0) }, { x: X(cl[0]), y: Z(T) }, LW.thin)
    P.line({ x: X(cl[1]), y: Z(0) }, { x: X(cl[1]), y: Z(T) }, LW.thin)
  }
  // the board's faces and its real edges; a break line where the view stops inside the board
  for (const [a, c] of board) {
    P.line({ x: X(a), y: Z(0) }, { x: X(c), y: Z(0) }, LW.thick)
    P.line({ x: X(a), y: Z(T) }, { x: X(c), y: Z(T) }, LW.thick)
    for (const e of [a, c]) {
      if (e <= wx0 + 1e-6 || e >= wx1 - 1e-6) P.breakLine(X(e), Z(0), Z(T))
      else P.line({ x: X(e), y: Z(0) }, { x: X(e), y: Z(T) }, LW.thick)
    }
  }

  // parts the plane passes through
  const cut = b.parts.flatMap((p) => {
    const raw = spanOf(boxOf(p), cy)
    const sp = raw && clip(raw)
    return sp ? [{ p, sp }] : []
  })
  const labels: { x: number; top: number; text: string }[] = []
  const front = b.copper[0].pads
  for (const { p, sp } of cut) {
    const pads = front.filter((q) => q[6] === p.ref)
    const bga = !p.back && p.kind === 'ic' && pads.length >= 36 && pads.every((q) => q[5] === 1)
    const base = p.back ? T : 0
    if (bga) {
      const ball = 0.3
      for (const q of pads) {
        const ch = chord(q[0], q[1], 0.25, cy)
        const cl = ch && clip(ch)
        if (!cl) continue
        P.put(`<ellipse cx="${f(X((cl[0] + cl[1]) / 2))}" cy="${f(Z(-ball / 2))}" rx="${f(((cl[1] - cl[0]) / 2) * s)}" ry="${f((ball / 2) * s)}" fill="url(#h-ball)" stroke-width="${LW.thin}"/>`)
      }
      const sub = 0.36
      P.rect(X(sp[0]), Z(-ball - sub), (sp[1] - sp[0]) * s, sub * s, LW.thin, 'fill="url(#h-b)"')
      P.rect(X(sp[0]), Z(-p.z), (sp[1] - sp[0]) * s, (p.z - ball - sub) * s, LW.thick, 'fill="url(#h-ic)"')
      const dw = (sp[1] - sp[0]) * 0.56
      P.solid(X((sp[0] + sp[1]) / 2) - (dw * s) / 2, Z(-ball - sub - 0.22), dw * s, 0.18 * s)
    } else {
      const lift = p.kind === 'ic' ? 0.08 : 0.04
      const y0 = p.back ? Z(base + lift) : Z(-p.z)
      P.rect(X(sp[0]), y0, (sp[1] - sp[0]) * s, (p.z - lift) * s, p.kind === 'ic' ? LW.thick : LW.thin, `fill="url(#h-${p.kind === 'ic' ? 'ic' : 'a'})"`)
      // pins of through-hole parts run through the board
      for (const q of b.copper[1]?.pads.filter((q) => q[6] === p.ref) ?? []) {
        const ch = chord(q[0], q[1], 0.32, cy)
        const cl = ch && clip(ch)
        if (cl) P.solid(X(cl[0]), Z(-0.6), (cl[1] - cl[0]) * s, (T + 2.1) * s)
      }
    }
    labels.push({ x: X((sp[0] + sp[1]) / 2), top: p.back ? Z(base + p.z) : Z(-p.z), text: p.ref })
  }
  // part labels: a short leader up to a row above the tallest body; neighbours closer than a label skip
  const ceiling = Math.min(Z0 - 8, ...labels.map((l) => l.top - 6))
  let last = -Infinity
  for (const l of labels.sort((a, c) => a.x - c.x)) {
    if (l.top > Z(T) || l.x - last < 12) continue
    last = l.x
    P.line({ x: l.x, y: l.top - 0.8 }, { x: l.x, y: ceiling + 1.5 }, LW.fine)
    P.put(`<circle class="fill" cx="${f(l.x)}" cy="${f(l.top - 0.8)}" r="0.35"/>`)
    P.text(l.text, l.x, ceiling - 3.4, 2.6, 'middle')
  }
  if (cut.some(({ p }) => p === L.hero) && Math.abs(cy - L.hero.y) < (L.hero.pitch || 0.8) / 2) {
    const q = front.filter((p) => p[6] === L.hero.ref).sort((a, c) => Math.abs(a[1] - cy) - Math.abs(c[1] - cy) || a[0] - c[0])[2]
    if (q) {
      const bx = X(q[0])
      P.circle({ x: bx, y: Z(-0.15) }, 6.5, LW.thin, HIDDEN)
      P.text('B', bx + 6.4, Z(-0.15) + 4.4, 3.6, 'middle', 0.36)
    }
  }

  // stackup callouts, every value read from the board file
  const lx = X(wx1) + 12
  layers.forEach((l, i) => {
    const mid = Z((zOf[l.name]?.[0] ?? 0) + l.t / 2)
    const ty = Z0 - 6 + i * 5.2
    P.line({ x: X(wx1) + 2, y: mid }, { x: lx - 2, y: ty + 1.3 }, LW.fine)
    P.line({ x: lx - 2, y: ty + 1.3 }, { x: lx, y: ty + 1.3 }, LW.fine)
    P.text(`${l.type === 'copper' ? l.name : /mask/i.test(l.type) ? l.type.toUpperCase() : `${l.material ?? ''} ${l.type.toUpperCase()}`.trim()}  ${l.t}`, lx + 1, ty, 2.4)
  })
  P.dim({ x: X(wx0), y: Z(0) }, { x: X(wx0), y: Z(T) }, 9, mm(T), 2.8)
  P.text('SECTION A-A', X(cx), Z(T) + 22, 7, 'middle', 0.6)
  P.text(`10:1  CUT AT Y ${cy.toFixed(2)}`, X(cx), Z(T) + 31, 3.2, 'middle')
  return P.out
}

// DETAIL B: the solder joint under one ball, 50:1, layers at their declared thickness
function detail(P: Pen, b: Board, hero: Part) {
  const S4 = 50
  const D = { x: DET.x, y: DET.y }
  const RD = DET.r
  const pad = b.copper[0].pads.find((p) => p[6] === hero.ref)
  const pd = pad?.[2] ?? 0.35
  const layers = b.stack.filter((l) => l.type === 'copper' || /core|prepreg/.test(l.type))
  const mask = b.stack.find((l) => /mask/i.test(l.type))?.t ?? 0.01
  const ball = 0.3
  P.put(`<clipPath id="det"><circle cx="${D.x}" cy="${D.y}" r="${RD}"/></clipPath><g clip-path="url(#det)">`)
  let z = 0
  let k = 0
  for (const l of layers) {
    if (l.type === 'copper') P.solid(D.x - RD, D.y + z * S4, 2 * RD, l.t * S4)
    else { P.rect(D.x - RD, D.y + z * S4, 2 * RD, l.t * S4, LW.thin, `fill="url(#h-${k % 2 ? 'b' : 'a'})"`); k++ }
    z += l.t
  }
  // the top copper is etched to the pad under the ball; mask covers the rest
  const cu = (layers.find((l) => l.type === 'copper')?.t ?? 0.035) * S4
  P.put(`<rect class="void" x="${D.x - RD}" y="${D.y}" width="${f(RD - (pd / 2) * S4)}" height="${f(cu)}"/><rect class="void" x="${f(D.x + (pd / 2) * S4)}" y="${D.y}" width="${f(RD)}" height="${f(cu)}"/>`)
  for (const sgn of [-1, 1]) {
    const x0 = sgn < 0 ? D.x - RD : D.x + (pd / 2) * S4 + 2
    P.rect(x0, D.y - mask * S4 - 0.3, RD - (pd / 2) * S4 - 2, mask * S4 + 0.3, LW.thin)
  }
  const rb = 0.25 * S4
  const pr = (pd / 2) * S4
  const top = D.y - ball * S4
  P.put(`<path d="M${f(D.x - pr)} ${f(D.y)}C${f(D.x - rb * 1.25)} ${f(D.y - ball * S4 * 0.45)} ${f(D.x - rb * 1.25)} ${f(D.y - ball * S4 * 0.85)} ${f(D.x - pr * 0.9)} ${f(top)}H${f(D.x + pr * 0.9)}C${f(D.x + rb * 1.25)} ${f(D.y - ball * S4 * 0.85)} ${f(D.x + rb * 1.25)} ${f(D.y - ball * S4 * 0.45)} ${f(D.x + pr)} ${f(D.y)}Z" fill="url(#h-ball)" stroke-width="${LW.thick}"/>`)
  P.rect(D.x - RD, top - 0.36 * S4, 2 * RD, 0.36 * S4, LW.thin, 'fill="url(#h-b)"')
  P.rect(D.x - RD, top - 0.36 * S4 - 30, 2 * RD, 30, LW.thick, 'fill="url(#h-ic)"')
  P.put('</g>')
  P.circle(D, RD, LW.thin)
  P.dim({ x: D.x - pr, y: D.y + cu }, { x: D.x + pr, y: D.y + cu }, 12, `Ø${mm(pd)} PAD`, 2.8)
  P.text('DETAIL B', D.x, D.y + RD + 8, 7, 'middle', 0.6)
  P.text('50:1', D.x, D.y + RD + 17, 3.2, 'middle')
}
