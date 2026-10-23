import { PALETTES } from '@silk-reel/choreo'
import { drawGlyphFrame } from '@silk-reel/render/film'
import type { Film } from '../world/world'

/** strip geometry in strip units (1 unit = 1 CSS px at k = 1), the same stock as the Paper comps */
export const N = 168
export const LF = 196
export const WS = 164
export const FW = 188
export const FH = 104
export const GAP = 8
export const M = 30
export const PERF_Y = [20, 144] as const
export const HERO_D = [110, 127] as const
export const ACT_AT: Record<number, string> = { 0: 'SPINE', 28: 'PILLARS', 84: 'FRAME', 140: 'LOOP' }
export const COLS = 14
export const HEAD = 1900

export const INK = '#0b0b0b'
export const RED = '#d7261e'
export const LIGHT = '#ffffff'

/** the board's part of the 16:9 film, as fractions of the frame */
const CROP = { x: 414 / 1920, y: 236 / 1080, w: 1092 / 1920, h: 603 / 1080 }
const MONO = "'JetBrains Mono', ui-monospace, monospace"

export const isHero = (d: number) => d >= HERO_D[0] && d <= HERO_D[1]
const pad3 = (v: number) => String(v).padStart(3, '0')

/** a drawing of the board, cropped to the board and set in a frame of w × h device px */
export function drawDrawing(ctx: CanvasRenderingContext2D, film: Film, d: number, x: number, y: number, w: number, h: number) {
  const tl = film.tl
  const s = w / (CROP.w * tl.width)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = '#050505'
  ctx.fillRect(x, y, w, h)
  ctx.setTransform(s, 0, 0, s, x - CROP.x * tl.width * s, y - CROP.y * tl.height * s)
  const hair = ((2 * Math.min(tl.width, tl.height)) / 1080) * s
  drawGlyphFrame(ctx, { ...tl, palette: PALETTES.mono }, film.scene, Math.min(tl.totalFrames - 1, 2 * d), { inkScale: Math.max(1, 1.25 / hair) })
  ctx.restore()
}

function perf(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.beginPath()
  ctx.roundRect(x - 6 * t, y - 4.5 * t, 12 * t, 9 * t, 1.6 * t)
  ctx.fill()
}

/** one length of stock: the frame, its perforations and the edge print, at (x, y) in a horizontal strip */
export function drawCell(ctx: CanvasRenderingContext2D, film: Film, d: number, x: number, y: number, t: number) {
  ctx.fillStyle = INK
  ctx.fillRect(x, y, LF * t, WS * t)
  const fx = x + (GAP / 2) * t, fy = y + M * t
  drawDrawing(ctx, film, d, fx, fy, FW * t, FH * t)
  const hero = isHero(d)
  ctx.strokeStyle = hero ? RED : '#303030'
  ctx.lineWidth = (hero ? 2 : 1) * t
  ctx.strokeRect(fx - ctx.lineWidth / 2, fy - ctx.lineWidth / 2, FW * t + ctx.lineWidth, FH * t + ctx.lineWidth)
  ctx.fillStyle = LIGHT
  for (let i = 0; i < 4; i++) for (const py of PERF_Y) perf(ctx, x + (LF / 8 + (i * LF) / 4) * t, y + py * t, t)
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${9 * t}px ${MONO}`
  ctx.fillStyle = hero ? RED : '#8a8a84'
  ctx.textAlign = 'center'
  ctx.fillText(pad3(2 * d), x + LF * 0.25 * t, y + 155.5 * t)
  if (d % 7 === 0) {
    ctx.textAlign = 'left'
    ctx.font = `700 ${9 * t}px ${MONO}`
    ctx.fillStyle = '#e1e1e1'
    const act = ACT_AT[d]
    ctx.fillText(`B${String(d / 7).padStart(2, '0')}${act ? `  ${act}` : ''}`, x + (LF * 0.25 - 7) * t, y + 8.5 * t)
  }
}

/** yield a whole frame, so the page paints between slices */
const tick = () => new Promise<void>((r) => { requestAnimationFrame(() => { setTimeout(r, 0) }) })

/** all 168 drawings on cells of stock, 14 to a row; built in slices so the countdown keeps time */
export async function buildAtlas(film: Film, t: number, onProgress: (p: number) => void, budget = 40) {
  const c = document.createElement('canvas')
  c.width = Math.ceil(COLS * LF * t)
  c.height = Math.ceil(Math.ceil(N / COLS) * WS * t)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  await tick()
  let since = performance.now()
  for (let d = 0; d < N; d++) {
    drawCell(ctx, film, d, (d % COLS) * LF * t, Math.floor(d / COLS) * WS * t, t)
    // yield once the slice has used its budget (ms), so the page keeps painting
    if (performance.now() - since > budget) { onProgress((d + 1) / N); await tick(); since = performance.now() }
  }
  onProgress(1)
  return c
}

/** the head leader: blank stock, then the name printed on the film */
export function buildHead(t: number, title = 'silk reel') {
  const c = document.createElement('canvas')
  c.width = Math.ceil(HEAD * t)
  c.height = Math.ceil(WS * t)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = LIGHT
  for (let x = LF / 8; x < HEAD; x += LF / 4) for (const py of PERF_Y) perf(ctx, x * t, py * t, t)
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${FH * 0.92 * t}px ${MONO}`
  ctx.fillStyle = '#f4f4f0'
  ctx.fillText(title, (LF + 70) * t, (M + FH / 2 + FH * 0.04) * t)
  return c
}
