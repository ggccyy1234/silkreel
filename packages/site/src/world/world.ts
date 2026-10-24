import { gsap } from 'gsap'
import { DECODE_IN, DECODE_OUT, PALETTES } from '@silk-reel/choreo'
import type { GlyphTimeline, Palette, PaletteId } from '@silk-reel/choreo'
import { buildScene, drawGlyphFrame } from '@silk-reel/render/film'
import type { Scene } from '@silk-reel/render/film'

export interface Film { key: string; tl: GlyphTimeline; scene: Scene }

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Where the film sits: `rect` is the frame in CSS px (null = the whole viewport), `zoom` scales the
 * film past its fit, and the composition point (fx, fy) lands on the frame point (cx, cy).
 */
export interface View { rect: Rect | null; zoom: number; cx: number; cy: number; fx: number; fy: number }

export interface FrameInfo { frame: number; beat: number; film: Film; rect: Rect }

const STEP_RATE = 15
const OUT_LEN = DECODE_OUT[0]?.length ?? 6
const IN_LEN = DECODE_IN[0]?.length ?? 5
const SPREAD = 4

export const filmFrom = (key: string, tl: GlyphTimeline): Film => ({ key, tl, scene: buildScene(tl) })

const hash = (i: number) => {
  let h = (i + 1) * 2654435761
  h ^= h >>> 13
  return (h >>> 0) % 997
}
const delayOf = (i: number) => hash(i) % (SPREAD + 1)

const mixHex = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const x = p(a), y = p(b)
  return '#' + x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')
}

/** one frame of the film; zoom > 1 moves in on the centre */
export function drawStill(target: HTMLCanvasElement, film: Film, frame: number, palette: Palette, zoom = 1) {
  const ctx = target.getContext('2d')
  if (!ctx) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, target.width, target.height)
  const s = (target.width / film.tl.width) * zoom
  ctx.setTransform(s, 0, 0, s, (target.width - film.tl.width * s) / 2, (target.height - film.tl.height * s) / 2)
  // a full-size export keeps the film's own hairline; a small still holds it at 1.6 px
  const hair = ((2 * Math.min(film.tl.width, film.tl.height)) / 1080) * s
  drawGlyphFrame(ctx, { ...film.tl, palette }, film.scene, frame, { inkScale: Math.max(1, 1.6 / hair) })
}

const follow = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt)

export class World {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private w = 0
  private h = 0
  private film: Film | null = null
  private prev: Film | null = null
  /** decode step at which the current film started replacing the previous one */
  private swapAt = -Infinity
  /** film time in seconds: advances only while playing */
  private clock = 0
  /** real time in seconds: drives decode steps, so transitions run while the film is held */
  private real = 0
  private playing = true
  private scrubFrame: number | null = null
  private view: View = { rect: null, zoom: 1, cx: 0.5, cy: 0.5, fx: 0.5, fy: 0.5 }
  private target: View = { ...this.view }
  private palette: Palette = PALETTES.mono
  private paletteFrom: Palette = PALETTES.mono
  private paletteTo: Palette = PALETTES.mono
  private paletteT = 1
  private dirty = true
  private lastKey = ''
  private listeners = new Set<(f: FrameInfo) => void>()
  private reduced: boolean

  constructor(canvas: HTMLCanvasElement, opts: { reduced: boolean }) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    this.ctx = ctx
    this.reduced = opts.reduced
    new ResizeObserver(() => { this.resize() }).observe(canvas)
    this.resize()
    gsap.ticker.add(() => { this.update() })
  }

  onFrame(fn: (f: FrameInfo) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** replace the film; the old one decodes out while the new one decodes in */
  show(film: Film, { decode = true } = {}) {
    if (this.film?.key === film.key) return
    this.prev = decode && !this.reduced ? this.film : null
    this.film = film
    this.swapAt = decode && !this.reduced ? Math.floor(this.real * STEP_RATE) : -Infinity
    this.dirty = true
  }

  /** decode the first film in from nothing: the loader's handoff */
  reveal() {
    this.prev = null
    this.swapAt = this.reduced ? -Infinity : Math.floor(this.real * STEP_RATE) - OUT_LEN
    this.dirty = true
  }

  setView(v: Partial<View>, { instant = false } = {}) {
    this.target = { ...this.target, ...v }
    if (instant || this.reduced) this.view = { ...this.target }
    this.dirty = true
  }

  play() { this.playing = !this.reduced; this.scrubFrame = null; this.dirty = true }
  pause() { this.playing = false }
  /** hold a frame, driven by scroll */
  scrub(frame: number) { this.scrubFrame = frame; this.dirty = true }
  /** jump the live clock so the film plays on from this frame */
  seek(frame: number) {
    const total = this.film?.tl.totalFrames ?? 1
    this.clock = frame / 30 + Math.floor(this.clock * 30 / total) * total / 30
    this.scrubFrame = null
    this.dirty = true
  }

  setPalette(id: PaletteId | Palette, { instant = false } = {}) {
    this.paletteFrom = this.palette
    this.paletteTo = typeof id === 'string' ? PALETTES[id] : id
    this.paletteT = instant || this.reduced ? 1 : 0
    if (this.paletteT === 1) this.palette = this.paletteTo
    this.dirty = true
  }

  /** the frame the film shows right now */
  frameNow(): number {
    const total = this.film?.tl.totalFrames ?? 1
    if (this.scrubFrame !== null) return Math.max(0, Math.min(total - 1, Math.round(this.scrubFrame)))
    return Math.floor(this.clock * 30) % total
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.w = this.canvas.clientWidth || window.innerWidth
    this.h = this.canvas.clientHeight || window.innerHeight
    this.canvas.width = Math.round(this.w * this.dpr)
    this.canvas.height = Math.round(this.h * this.dpr)
    this.dirty = true
  }

  private update() {
    const dt = Math.min(0.1, gsap.ticker.deltaRatio(60) / 60)
    this.real += dt
    if (this.playing && this.scrubFrame === null) this.clock += dt

    const v = this.view, t = this.target
    const rate = 7
    v.zoom = follow(v.zoom, t.zoom, rate, dt)
    v.cx = follow(v.cx, t.cx, rate, dt)
    v.cy = follow(v.cy, t.cy, rate, dt)
    v.fx = follow(v.fx, t.fx, rate, dt)
    v.fy = follow(v.fy, t.fy, rate, dt)
    const full = { x: 0, y: 0, w: this.w, h: this.h }
    const tr = t.rect ?? full
    const cr = v.rect ?? full
    v.rect = { x: follow(cr.x, tr.x, 9, dt), y: follow(cr.y, tr.y, 9, dt), w: follow(cr.w, tr.w, 9, dt), h: follow(cr.h, tr.h, 9, dt) }
    if (this.paletteT < 1) {
      this.paletteT = Math.min(1, this.paletteT + dt / 0.6)
      const k = 1 - Math.pow(1 - this.paletteT, 3)
      const a = this.paletteFrom, b = this.paletteTo
      this.palette = { ...b, bg: mixHex(a.bg, b.bg, k), silk: mixHex(a.silk, b.silk, k), head: mixHex(a.head, b.head, k) }
    }

    const film = this.film
    if (!film) return
    const frame = this.frameNow()
    const step = Math.floor(this.real * STEP_RATE)
    const k = [frame, step - this.swapAt < OUT_LEN + IN_LEN + 2 * SPREAD ? step : 0, v.zoom.toFixed(4), v.cx.toFixed(4), v.cy.toFixed(4), v.fx.toFixed(4), v.fy.toFixed(4),
      v.rect.x.toFixed(1), v.rect.y.toFixed(1), v.rect.w.toFixed(1), v.rect.h.toFixed(1), this.palette.bg, this.palette.silk, film.key].join()
    if (!this.dirty && k === this.lastKey) return
    this.lastKey = k
    this.dirty = false
    this.draw(film, frame, step)
    const info = { frame, beat: (frame / film.tl.totalFrames) * 24, film, rect: v.rect }
    this.listeners.forEach((fn) => { fn(info) })
  }

  private place(ctx: CanvasRenderingContext2D, tl: GlyphTimeline) {
    const r = this.view.rect ?? { x: 0, y: 0, w: this.w, h: this.h }
    const fit = Math.min(r.w / tl.width, r.h / tl.height)
    const s = fit * this.view.zoom
    const ox = r.x + this.view.cx * r.w - this.view.fx * tl.width * s
    const oy = r.y + this.view.cy * r.h - this.view.fy * tl.height * s
    ctx.setTransform(this.dpr * s, 0, 0, this.dpr * s, this.dpr * ox, this.dpr * oy)
    // the hairline keeps the output's visual weight: thinner under a zoomed camera, never under the floor
    // in a small preview, like a font at its optical size
    const hair = ((2 * Math.min(tl.width, tl.height)) / 1080) * this.dpr * s
    return Math.max(1 / this.view.zoom, 1.6 / hair)
  }

  private draw(film: Film, frame: number, step: number) {
    const ctx = this.ctx
    const pal = this.palette
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const r = this.target.rect ? this.view.rect : null
    // a framed film carries its own ground inside the frame; the page shows around it
    ctx.fillStyle = pal.bg
    if (r) ctx.fillRect(r.x * this.dpr, r.y * this.dpr, r.w * this.dpr, r.h * this.dpr)
    else ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    if (r) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(r.x * this.dpr, r.y * this.dpr, r.w * this.dpr, r.h * this.dpr)
      ctx.clip()
    }
    const since = step - this.swapAt
    const prev = this.prev
    if (prev && since < OUT_LEN + SPREAD) {
      const inkScale = this.place(ctx, prev.tl)
      const pf = Math.min(frame, prev.tl.totalFrames - 1)
      drawGlyphFrame(ctx, { ...prev.tl, palette: pal }, prev.scene, pf, {
        inkScale,
        alpha: (i) => {
          const at = since - delayOf(i)
          if (at < 0) return 1
          return DECODE_OUT[i % DECODE_OUT.length]?.[at] ?? 0
        }
      })
    } else if (prev) this.prev = null
    const inAt = since - (prev ? OUT_LEN - 2 : 0)
    const inkScale = this.place(ctx, film.tl)
    const alpha = (i: number) => {
      const at = inAt - delayOf(i)
      if (at < 0) return 0
      return DECODE_IN[i % DECODE_IN.length]?.[at] ?? 1
    }
    drawGlyphFrame(ctx, { ...film.tl, palette: pal }, film.scene, frame, inAt >= IN_LEN + SPREAD ? { inkScale } : { inkScale, alpha })
    if (r) ctx.restore()
  }
}
