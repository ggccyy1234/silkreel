import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { PALETTES } from '@silk-reel/choreo'
import type { Aspect, PaletteId } from '@silk-reel/choreo'
import { World, drawStill } from '../world/world'
import type { Film } from '../world/world'
import { filmOf, filmOwnBoard, fixtureFilm } from '../world/films'
import { ROOM } from '../world/room'
import { acts, boards } from '../data/site'
import { prefersReducedMotion } from '../engine/env'
import { ReelGL } from '../reel/reel-gl'
import type { ReelPose } from '../reel/reel-gl'
import { FH, FW, GAP, LF, M, N, RED, WS, buildAtlas, buildHead, drawDrawing, isHero } from '../reel/strip'
import { rollTo } from './site'

gsap.registerPlugin(ScrollTrigger)

const $ = (s: string, r: ParentNode = document) => r.querySelector<HTMLElement>(s)
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T[] => [...r.querySelectorAll<T>(s)]
const phone = () => matchMedia('(max-width: 760px)').matches
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const pad = (v: number, n = 2) => String(Math.floor(v)).padStart(n, '0')
const tc = (frame: number) => `${pad(frame / 30 / 60)}:${pad((frame / 30) % 60)}.${pad(((frame / 30) % 1) * 100)}`
const actAt = (beat: number) => [...acts].reverse().find((a) => a.at <= beat) ?? acts[0]
const dprOf = () => Math.min(2, devicePixelRatio || 1)
const FRAMES = 336
const GROUND = '#ecede9'

/** where the coil sits in the hero: the Paper comp at 1440 × 900, scaled by the viewport */
function heroPose(): Omit<ReelPose, 'ex'> {
  if (phone()) return { k: 0.45, cx: -84, ly: 356, leader: innerWidth + 200 }
  const k = clamp(innerWidth / 1440, 0.7, 1.3)
  return { k, cx: innerWidth * 0.05, ly: 78 + 91 * k, leader: innerWidth * 1.1 }
}

export function setupHome() {
  const reduced = prefersReducedMotion()
  const html = document.documentElement
  const heroFilm = fixtureFilm('icebreaker', '16:9')

  /* ---------- the countdown: three beats, each numeral routed like a trace while the readout names the real board ---------- */
  const BEAT = 0.5
  const count = $('[data-count]')
  const sweep = $('[data-count-sweep]')
  const board = $('[data-count-board]')
  const seen = (() => { try { return sessionStorage.getItem('sr-seen') === '1' } catch { return false } })()
  const counting = !reduced && !seen && count !== null
  if (!counting) count?.remove()
  else { html.classList.add('counting'); try { sessionStorage.setItem('sr-seen', '1') } catch { /* private mode */ } }
  let t0 = performance.now()
  // the first beat started in CSS at first paint: find how far it has run, hand its parts to the script, and start the script's clock there
  let ran = 0
  if (counting) {
    const css = count.getAnimations({ subtree: true })
    const beam = css.find((a) => a instanceof CSSAnimation && a.animationName === 'count-sweep')
    ran = Math.min(1.2, Number(beam?.currentTime ?? 0) / 1000)
    t0 -= ran * 1000
    for (const a of css) { if (a instanceof CSSAnimation && a.animationName === 'count-draw') a.commitStyles(); a.cancel() }
  }
  const paintCount = () => {
    const a = (((performance.now() - t0) / 1000 / BEAT) % 1) * Math.PI * 2
    sweep?.style.setProperty('--a', `${((a * 180) / Math.PI).toFixed(1)}deg`)
    routeTo((performance.now() - t0) / 1000)
  }
  /* the board's traces route out from U4: each is drawn as the growing copper reaches it, and on the last beat light runs down them */
  const routesEl = document.querySelector<HTMLCanvasElement>('[data-count-routes]')
  const pulseEl = document.querySelector<HTMLCanvasElement>('[data-count-pulse]')
  let routes: { r: number; t: number[] }[] = []
  let routed = 0
  let pulsed = 0
  let px = 1
  const trace = (ctx: CanvasRenderingContext2D | null | undefined, t: number[], k: number) => {
    if (!ctx) return
    ctx.lineWidth = Math.max(1.2, (t[0] ?? 3) * px * k)
    ctx.beginPath()
    ctx.moveTo((t[1] ?? 0) * px, (t[2] ?? 0) * px)
    for (let i = 3; i < t.length; i += 2) ctx.lineTo((t[i] ?? 0) * px, (t[i + 1] ?? 0) * px)
    ctx.stroke()
  }
  const routeTo = (sec: number) => {
    const grow = 130 * Math.min(1, sec)
    const rctx = routesEl?.getContext('2d')
    while (routed < routes.length && (routes[routed]?.r ?? 999) <= grow) trace(rctx, routes[routed++]?.t ?? [], 1)
    const pt = (sec - 2 * BEAT) / 0.32
    if (pt <= 0) return
    const pctx = pulseEl?.getContext('2d')
    while (pulsed < routes.length && (routes[pulsed]?.r ?? 999) <= 130 * Math.min(1, pt)) trace(pctx, routes[pulsed++]?.t ?? [], 1.8)
  }
  /* the copper plate is drawn into canvases, not set as images, so the leader never becomes the page's largest paint */
  const copper = new Image()
  const copperReady = counting ? (copper.src = '/img/icebreaker-cu.webp', copper.decode().then(() => copper, () => null)) : Promise.resolve(null)
  const paintCopper = (el: HTMLCanvasElement, w = el.clientWidth, h = el.clientHeight) => {
    void copperReady.then((img) => {
      if (!img) return
      const dpr = Math.min(2, devicePixelRatio || 1)
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      el.getContext('2d')?.drawImage(img, 0, 0, el.width, el.height)
    })
  }
  if (counting) for (const el of document.querySelectorAll<HTMLCanvasElement>('canvas.count__board')) paintCopper(el)
  if (counting && routesEl && pulseEl) {
    void fetch('/films/icebreaker-routes.json').then((r) => r.json() as Promise<{ w: number; h: number; u4: [number, number]; t: number[][] }>).then((R) => {
      const norm = Math.hypot(R.w, R.h) / Math.SQRT2
      routes = R.t.map((t) => {
        let d = Infinity
        for (let i = 1; i < t.length; i += 2) d = Math.min(d, Math.hypot((t[i] ?? 0) - R.u4[0], (t[i + 1] ?? 0) - R.u4[1]))
        return { r: (d / norm) * 100, t }
      })
      const dpr = Math.min(2, devicePixelRatio || 1)
      for (const [el, color] of [[routesEl, '#d79a68'], [pulseEl, '#fff3e4']] as const) {
        el.width = Math.round(el.clientWidth * dpr)
        el.height = Math.round(el.clientHeight * dpr)
        const ctx = el.getContext('2d')
        if (ctx) { ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round' }
      }
      px = routesEl.width / R.w
    }, () => {})
  }
  const leader = gsap.timeline({ paused: !counting })
  let stopLeaderFilm = () => {}
  if (counting) {
    gsap.ticker.add(paintCount)
    const digits = [...count.querySelectorAll<SVGPathElement>('[data-digit]')]
    const head = count.querySelector<SVGCircleElement>('[data-count-head]')
    const read = $('[data-count-read]')
    const reads = JSON.parse(read?.dataset.reads ?? '[]') as string[]
    digits.forEach((path, i) => {
      const at = i * BEAT
      const len = path.getTotalLength()
      const pen = { p: 0 }
      leader.call(() => { if (read) read.textContent = reads[i] ?? '' }, [], at)
      leader.set(path, { opacity: 1 }, at)
      leader.set(head ?? {}, { opacity: 1 }, at)
      leader.to(pen, {
        p: 1, duration: i ? 0.32 : 0.24, ease: i ? 'power2.inOut' : 'power2.out',
        onUpdate: () => {
          path.style.strokeDashoffset = String(1 - pen.p)
          const pt = path.getPointAtLength(len * pen.p)
          head?.setAttribute('cx', pt.x.toFixed(2)); head?.setAttribute('cy', pt.y.toFixed(2))
        }
      }, at)
      leader.set(head ?? {}, { opacity: 0 }, at + 0.38)
      // the numeral leaves the way a frame leaves the gate: one jump up and gone
      if (i < digits.length - 1) leader.to(path, { opacity: 0, y: -6, duration: 0.06, ease: 'power1.in' }, at + BEAT - 0.06)
    })
    // on the last beat the board becomes the film: the copper gives way to the drawings racing past
    const filmEl = count.querySelector<HTMLCanvasElement>('[data-count-film]')
    if (board) leader.to(board, { opacity: 0.95, duration: 0.3, ease: 'power2.out' }, 2 * BEAT)
    // U4 takes the light: the lit copper spreads out from the chip across the board
    const lit = $('[data-count-lit]')
    // the 1 steps back once drawn, so U4 is clear when it takes the light
    const one = digits[2]
    if (one) leader.to(one, { opacity: 0.28, duration: 0.15, ease: 'power1.out' }, 2 * BEAT + 0.3)
    if (lit) leader.fromTo(lit, { opacity: 1, '--pow': '0%' }, { '--pow': '130%', duration: 0.28, ease: 'power1.out' }, 2 * BEAT)
    if (pulseEl) leader.to(pulseEl, { opacity: 0, duration: 0.6, ease: 'power2.out' }, 2 * BEAT + 0.32)
    if (filmEl) leader.to(filmEl, { opacity: 0.22, duration: 0.25, ease: 'power1.out' }, 2 * BEAT + 0.05)
    // the land waits (briefly) for the reel, so the frames have somewhere to go
    leader.seek(ran)
    leader.call(() => { void Promise.race([reelReady, new Promise((r) => setTimeout(r, 900))]).then(() => land?.()) }, [], digits.length * BEAT - 0.05)
    // behind the numerals the whole film runs past at speed: the leader previews the reel it heads
    const filmCanvas = count.querySelector<HTMLCanvasElement>('[data-count-film]')
    if (filmCanvas) {
      const ff = new World(filmCanvas, { reduced })
      ff.setPalette(ROOM, { instant: true })
      ff.setView({ zoom: 1920 / 1092, fx: 0.5, fy: 0.5, cx: 0.5, cy: 0.5 }, { instant: true })
      const counter = $('[data-count-n]')
      const run = () => {
        const f = Math.min(335, ((performance.now() - t0) / 1000 / (digits.length * BEAT)) * 335)
        ff.scrub(f)
        if (counter) counter.textContent = String(Math.floor(f)).padStart(3, '0')
      }
      void heroFilm.then((film) => {
        if (!land) return
        ff.show(film, { decode: false })
        filmCanvas.classList.add('is-on')
        gsap.ticker.add(run)
        stopLeaderFilm = () => { gsap.ticker.remove(run); ff.destroy() }
      })
    }
  }

  /* ---------- the reel: one fixed GL canvas behind the hero ---------- */
  const glCanvas = document.querySelector<HTMLCanvasElement>('[data-reel]')
  const hero = $('#top')
  let reel: ReelGL | null = null
  let ex = 0
  let exTarget = 0
  const idle = reduced ? 0 : 0.12
  const atlasT = Math.min(1.49, heroPose().k * dprOf() * 1.1)

  const atlasReady = heroFilm.then(async (film) => {
    await document.fonts.ready
    // while the leader runs, the atlas works in 5 ms slices so the countdown never drops a frame
    const atlas = await buildAtlas(film, atlasT, () => {}, counting ? 5 : 40)
    return { film, atlas }
  })

  const startReel = (canvas: HTMLCanvasElement, atlas: HTMLCanvasElement) => {
    const ht = Math.min(2.4, heroPose().k * dprOf())
    try {
      return new ReelGL(canvas, { canvas: atlas, t: atlasT }, { canvas: buildHead(ht), t: ht }, GROUND)
    } catch {
      return null
    }
  }

  // the texture upload stalls a frame or two: during the countdown it waits for the held "1", where nothing moves
  const reelReady = atlasReady.then(async ({ atlas }) => {
    if (counting) await new Promise((r) => setTimeout(r, Math.max(0, t0 + 1250 - performance.now())))
    if (glCanvas) reel = startReel(glCanvas, atlas)
    if (!reel) html.classList.remove('gl')
    if (reel && glCanvas) {
      // draw once now and let two frames pass: the GPU does its first-draw work here, inside the held "1", not during the land
      drawReel()
      await new Promise((r) => { requestAnimationFrame(() => { requestAnimationFrame(r) }) })
      html.classList.add('reel-live')
      gsap.ticker.add(drawReel)
    }
  }, () => { html.classList.remove('gl') })

  // while the leader lands, the strip's pay-out is driven directly: the board's frames wind onto the reel
  let wind: { v: number } | null = null
  let drawn = ''
  function drawReel() {
    if (!reel || !hero) return
    const dt = gsap.ticker.deltaRatio(60) / 60
    exTarget += idle * dt
    ex += (exTarget - ex) * (1 - Math.exp(-6 * dt))
    const hr = hero.getBoundingClientRect()
    let pose: ReelPose | null = null
    if (hr.bottom > 0) {
      const base = heroPose()
      const scrolled = reduced ? 0 : clamp(-hr.top / Math.max(1, hr.height), 0, 1)
      pose = { ...base, ly: base.ly + hr.top, ex: clamp((wind ? wind.v : ex) + scrolled * 9, 0, N - 1) }
    }
    /* off screen the canvas would keep its last frame; hide it instead */
    if (glCanvas) glCanvas.style.visibility = pose ? '' : 'hidden'
    if (!pose) return
    const key = `${pose.k.toFixed(3)},${pose.cx.toFixed(1)},${pose.ly.toFixed(1)},${pose.ex.toFixed(4)},${innerWidth},${innerHeight}`
    if (key === drawn) return
    drawn = key
    reel.draw(pose, dprOf())
  }

  let land: (() => void) | null = counting ? () => {
    land = null
    leader.kill()
    gsap.ticker.remove(paintCount)
    const frame = $('[data-count-frame]')
    const p = heroPose()
    // six frames of the leader, left to right, as they sit with six drawings paid out ahead of PICTURE START
    const CELLS = 6
    const cellAt = (i: number) => ({ x: p.cx + (i * LF + GAP / 2) * p.k, y: p.ly - (WS / 2 - M) * p.k, w: FW * p.k, h: FH * p.k })
    wind = { v: CELLS }
    const tl = gsap.timeline({ onComplete: () => { stopLeaderFilm(); count.remove(); html.classList.remove('counting') } })
    tl.to(count.querySelectorAll('.count__digit, .count__perf'), { opacity: 0, duration: 0.18, ease: 'power1.out' }, 0.05)
    tl.to(count.querySelectorAll('.count__k, .count__n, .count__read, .count__dial, .count__beam, .count__film'), { opacity: 0, duration: 0.2, ease: 'power1.out' }, 0)
    frame?.classList.add('is-landing')
    if (frame) tl.set(frame, { backgroundColor: 'rgb(11 11 11 / 0)' }, 0)
    // the lit board prints itself into each frame of the leader, then each print develops into that frame's drawing
    const plate = $('[data-count-board]')
    const pr = plate?.getBoundingClientRect()
    const midCell = cellAt((CELLS - 1) / 2)
    const copies: { el: HTMLCanvasElement; i: number; x0: number }[] = []
    if (plate && pr) {
      tl.set([plate, $('[data-count-lit]'), routesEl, pulseEl], { opacity: 0 }, 0)
      const pw = plate.offsetWidth, ph = plate.offsetHeight
      const pcx = pr.left + pr.width / 2, pcy = pr.top + pr.height / 2
      const turned = pr.height > pr.width ? 90 : 0
      for (let i = 0; i < CELLS; i++) {
        const c = cellAt(i)
        const copy = document.createElement('canvas')
        copy.className = 'count__copy'
        paintCopper(copy, pw, ph)
        // sized as the plate is laid out (a phone turns it upright), placed on its centre, and turned flat as it flies
        Object.assign(copy.style, { left: `${String(pcx - pw / 2)}px`, top: `${String(pcy - ph / 2)}px`, width: `${String(pw)}px`, height: `${String(ph)}px` })
        count.append(copy)
        gsap.set(copy, { rotate: turned })
        // first as one plate down to the strip, then dealt out frame by frame
        tl.to(copy, { x: midCell.x + midCell.w / 2 - pcx, y: midCell.y + midCell.h / 2 - pcy, scaleX: midCell.w / pw, scaleY: midCell.h / ph, rotate: 0, duration: 0.45, ease: 'power3.inOut' }, 0)
        tl.to(copy, { x: c.x + c.w / 2 - pcx, duration: 0.3, ease: 'power3.inOut' }, 0.4 + 0.02 * Math.abs(i - (CELLS - 1) / 2))
        copies.push({ el: copy, i, x0: pcx - c.w / 2 })
      }
    }
    tl.to(count, { '--wipe': '100%', duration: 0.4, ease: 'power2.inOut' }, 0)
    // the copper prints ride the strip as it winds, and each goes out as it reaches the reel
    const ride = () => {
      if (!wind) return
      for (const c of copies) {
        const x = cellAt(c.i - (CELLS - wind.v)).x
        gsap.set(c.el, { x: x - c.x0, opacity: clamp((x - p.cx) / (LF * p.k) + 0.5, 0, 1) })
      }
    }
    tl.to(wind, { v: 0, duration: 0.8, ease: 'power2.inOut', onUpdate: ride, onComplete: () => { ex = 0; wind = null } }, 0.7)
  } : null
  /* a click or a key during the countdown runs it out at once */
  if (counting) {
    const skip = () => land?.()
    addEventListener('pointerdown', skip, { once: true })
    addEventListener('keydown', skip, { once: true })
  }

  /* ---------- the gate: scroll pulls the strip through; the screen shows what is in it ---------- */
  const gate = $('[data-gate]')
  const strip = document.querySelector<HTMLCanvasElement>('[data-strip]')
  const screenCanvas = document.querySelector<HTMLCanvasElement>('[data-screen-film]')
  const screen = new World(screenCanvas ?? document.createElement('canvas'), { reduced })
  screen.setPalette(ROOM, { instant: true })
  screen.setView({ zoom: 1920 / 1092, fx: 0.5, fy: 0.5, cx: 0.5, cy: 0.5 }, { instant: true })
  let frameNow = 240
  let playing = false
  let stripFilm: Film | null = null
  const readD = $('[data-g-d]'), readF = $('[data-g-f]'), readB = $('[data-g-b]'), readAct = $('[data-g-act]'), readTc = $('[data-g-tc]')
  const beatFill = $('[data-beat-fill]')
  const heroNote = $('.gate__hero')
  const beatActs = $$('[data-beat-act]')

  const paintStrip = (f: number) => {
    if (!strip || !stripFilm) return
    const dpr = dprOf()
    const w = strip.clientWidth, h = strip.clientHeight
    if (strip.width !== Math.round(w * dpr) || strip.height !== Math.round(h * dpr)) { strip.width = Math.round(w * dpr); strip.height = Math.round(h * dpr) }
    const ctx = strip.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#0b0b0b'
    ctx.fillRect(0, 0, strip.width, strip.height)
    /* the strip steps a whole drawing at a time, like a projector's claw, so the gate always holds one frame */
    const dCur = Math.round(f / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    /* a vertical strip on desktop (next frames above), a horizontal one on a phone (next frames to the right) */
    const across = w > h
    const sv = across ? (h * dpr) / 494 : (w * dpr) / 738
    const fw = 546 * sv, fh = 302 * sv, edge = 96 * sv, pitch = (across ? 568 : 324) * sv
    const mid = (across ? strip.width : strip.height) / 2
    const reach = Math.ceil(mid / pitch) + 1
    ctx.font = `500 ${Math.round(22 * sv)}px 'JetBrains Mono', monospace`
    for (let d = Math.floor(dCur) - reach; d <= Math.ceil(dCur) + reach; d++) {
      const dd = ((d % N) + N) % N
      const c = across ? mid + (d - dCur) * pitch : mid + (dCur - d) * pitch
      const fx = across ? c - fw / 2 : edge, fy = across ? edge : c - fh / 2
      drawDrawing(ctx, stripFilm, dd, fx, fy, fw, fh)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const hot = isHero(dd)
      ctx.strokeStyle = hot ? RED : '#303030'
      ctx.lineWidth = (hot ? 3 : 1.5) * sv
      ctx.strokeRect(fx, fy, fw, fh)
      ctx.fillStyle = '#ffffff'
      for (let i = 0; i < 4; i++) {
        const along = c - pitch / 2 + (i + 0.5) * (pitch / 4)
        const sides = across ? [edge / 2 - 6 * sv, strip.height - edge / 2 + 6 * sv] : [edge / 2 + 6 * sv, strip.width - edge / 2 - 6 * sv]
        for (const side of sides) {
          ctx.beginPath()
          if (across) ctx.roundRect(along - 17 * sv, side - 13 * sv, 34 * sv, 26 * sv, 5 * sv)
          else ctx.roundRect(side - 13 * sv, along - 17 * sv, 26 * sv, 34 * sv, 5 * sv)
          ctx.fill()
        }
      }
      ctx.fillStyle = hot ? RED : '#8a8a84'
      if (across) {
        ctx.fillText(pad(dd * 2, 3), c, strip.height - 12 * sv)
      } else {
        ctx.save()
        ctx.translate(strip.width - 14 * sv, c)
        ctx.rotate(-Math.PI / 2)
        ctx.fillText(pad(dd * 2, 3), 0, 0)
        ctx.restore()
      }
    }
  }

  const screenEl = document.querySelector<HTMLElement>('[data-screen]')
  const showFrame = (f: number) => {
    frameNow = ((Math.round(f) % FRAMES) + FRAMES) % FRAMES
    paintStrip(f)
    const beat = Math.floor(frameNow / 14)
    if (readD) readD.textContent = pad(frameNow / 2, 3)
    if (readF) readF.textContent = pad(frameNow, 3)
    if (readB) readB.textContent = pad(beat + 1)
    screenEl?.setAttribute('aria-valuenow', String(frameNow))
    screenEl?.setAttribute('aria-valuetext', `Frame ${frameNow} of ${FRAMES}, beat ${beat + 1}`)
    const act = actAt(beat)
    if (readAct) readAct.textContent = act.label
    if (readTc) readTc.textContent = tc(frameNow)
    if (beatFill) beatFill.style.scale = `${((frameNow + 1) / FRAMES).toFixed(4)} 1`
    beatActs.forEach((li) => { li.classList.toggle('is-on', li.dataset.beatAct === act.id) })
    heroNote?.classList.toggle('is-on', frameNow >= 220 && frameNow <= 254)
  }

  void heroFilm.then((film) => {
    stripFilm = film
    screen.show(film, { decode: false })
    screen.scrub(frameNow)
    showFrame(frameNow)
  })

  screen.onFrame((info) => { if (playing) showFrame(info.frame) })
  const stopPlay = () => {
    if (!playing) return
    playing = false
    screen.pause()
    screen.scrub(frameNow)
    gate?.classList.remove('is-playing')
  }

  const beam = () => {
    const box = $('.gate__box')?.getBoundingClientRect()
    const sc = $('[data-screen]')?.getBoundingClientRect()
    const svg = document.querySelector<SVGSVGElement>('[data-beam]')
    const pin = $('.gate__pin')?.getBoundingClientRect()
    if (!box || !sc || !svg || !pin) return
    const o = (x: number, y: number) => `${(x - pin.left).toFixed(1)},${(y - pin.top).toFixed(1)}`
    /* the light leaves the gate toward the screen: to the right on desktop, upward on a phone */
    const up = sc.bottom <= box.top
    const g1 = up ? [box.left + 6, box.top] : [box.right, box.top + 6]
    const g2 = up ? [box.right - 6, box.top] : [box.right, box.bottom - 6]
    const s1 = up ? [sc.left, sc.bottom] : [sc.left, sc.top]
    const s2 = up ? [sc.right, sc.bottom] : [sc.left, sc.bottom]
    const pts = [g1, s1, s2, g2].map(([x, y]) => o(x ?? 0, y ?? 0))
    $('[data-beam-poly]', svg)?.setAttribute('points', pts.join(' '))
    const line = (el: HTMLElement | null, p: number[], q: number[]) => {
      el?.setAttribute('x1', String((p[0] ?? 0) - pin.left)); el?.setAttribute('y1', String((p[1] ?? 0) - pin.top))
      el?.setAttribute('x2', String((q[0] ?? 0) - pin.left)); el?.setAttribute('y2', String((q[1] ?? 0) - pin.top))
    }
    line($('[data-beam-a]', svg), g1, s1)
    line($('[data-beam-b]', svg), g2, s2)
    const grad = svg.querySelector('linearGradient')
    grad?.setAttribute('x2', up ? '0' : '1'); grad?.setAttribute('y1', up ? '1' : '0')
  }

  if (gate && !reduced) {
    ScrollTrigger.create({
      trigger: gate,
      start: 'top top',
      end: () => `+=${innerHeight * 2.6}`,
      pin: '.gate__pin',
      invalidateOnRefresh: true,
      onUpdate: (st) => {
        if (playing) return
        const f = st.progress * (FRAMES - 1)
        screen.scrub(f)
        showFrame(f)
      },
      onRefresh: beam
    })
  }
  addEventListener('resize', () => { beam(); showFrame(frameNow) })
  requestAnimationFrame(beam)

  const gateInView = () => {
    const r = gate?.getBoundingClientRect()
    return !!r && r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5
  }
  addEventListener('keydown', (e) => {
    if (!gateInView() || (e.target instanceof HTMLElement && e.target.closest('input, textarea, button, a, [role="radio"]'))) return
    if (e.key === ' ') {
      e.preventDefault()
      if (playing) { stopPlay(); return }
      playing = true
      gate?.classList.add('is-playing')
      screen.seek(frameNow)
      screen.play()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      stopPlay()
      const f = frameNow + (e.key === 'ArrowRight' ? 2 : -2)
      screen.scrub(((f % FRAMES) + FRAMES) % FRAMES)
      showFrame(f)
    }
  })
  addEventListener('wheel', stopPlay, { passive: true })
  addEventListener('touchmove', stopPlay, { passive: true })

  /* ---------- two looks: the trace render and the live glyph film play while they are on screen ---------- */
  const lookCanvas = document.querySelector<HTMLCanvasElement>('[data-look-film]')
  const lookVideo = document.querySelector<HTMLVideoElement>('[data-look-video]')
  if (lookCanvas) {
    const look = new World(lookCanvas, { reduced })
    look.setPalette(ROOM, { instant: true })
    look.setView({ zoom: 1920 / 1092, fx: 0.5, fy: 0.5, cx: 0.5, cy: 0.5 }, { instant: true })
    void heroFilm.then((film) => { look.show(film, { decode: false }); if (reduced) look.scrub(182); else look.seek(182) })
    new IntersectionObserver(([e]) => {
      const on = e?.isIntersecting === true && !reduced
      if (on) { look.play(); void lookVideo?.play().catch(() => { /* the poster stays */ }) } else { look.pause(); look.seek(182); lookVideo?.pause() }
    }, { threshold: 0.25 }).observe(lookCanvas)
  }
  if (reduced && lookVideo) lookVideo.controls = true

  const input = document.querySelector<HTMLInputElement>('[data-file]')

  /* ---------- one command: each word picks a value, the monitor plays the film the line would render ---------- */
  type Style = 'glyph' | 'trace'
  const monitorStage = $('[data-monitor]')
  const monitorCanvas = document.querySelector<HTMLCanvasElement>('[data-monitor-film]')
  const monitorVideo = document.querySelector<HTMLVideoElement>('[data-monitor-video]')
  const monitor = new World(monitorCanvas ?? document.createElement('canvas'), { reduced })
  const state: { board: string; style: Style; aspect: Aspect; ink: PaletteId } = { board: 'icebreaker', style: 'glyph', aspect: '16:9', ink: 'mono' }
  try { const s = localStorage.getItem('sr-ink'); if (s && s in PALETTES) state.ink = s as PaletteId } catch { /* private mode */ }
  const names = new Map<string, { name: string; file: string; parts: number; own?: true }>(boards.map((b) => [b.id, { name: b.name, file: `${b.id}.kicad_pcb`, parts: b.footprints }]))
  monitor.setPalette(state.ink, { instant: true })

  const stage = $('[data-monitor-stage]')
  const frameRect = () => ({ x: 0, y: 0, w: stage?.clientWidth ?? 0, h: stage?.clientHeight ?? 0 })
  const fitStage = () => {
    monitorStage?.style.setProperty('--ar', state.aspect.replace(':', ' / '))
    monitorStage?.style.setProperty('--film-bg', state.style === 'trace' ? '#0b0b0b' : PALETTES[state.ink].bg)
  }
  const monitorRead = $('[data-monitor-read]')
  const monitorTc = $('[data-monitor-tc]')
  const cmdNote = $('[data-cmd-note]')
  const stillBtn = $('[data-still]')
  const takeBtn = $('[data-take]')
  monitor.onFrame((info) => { if (monitorTc && state.style === 'glyph') monitorTc.textContent = tc(info.frame) })
  monitorVideo?.addEventListener('timeupdate', () => { if (monitorTc) monitorTc.textContent = tc(monitorVideo.currentTime * 30) })
  const tokVal = (k: string) => $(`[data-tok="${k}"] [data-tok-v]`)
  const tokens = () => {
    const b = names.get(state.board)
    const out = [b?.file ?? 'board.kicad_pcb', '--style', state.style, '--aspect', state.aspect]
    if (state.style === 'glyph') out.push('--palette', state.ink)
    return out
  }
  const paintCmd = () => {
    const b = names.get(state.board)
    const vals: Record<string, string> = { board: b?.file ?? 'board.kicad_pcb', style: state.style, aspect: state.aspect, palette: state.ink }
    for (const [k, v] of Object.entries(vals)) {
      const el = tokVal(k)
      if (el) rollTo(el, v)
      $(`[data-tok="${k}"]`)?.setAttribute('aria-label', `${k[0]?.toUpperCase()}${k.slice(1)}: ${v}. Change the ${k}`)
    }
    const pal = $('[data-tok="palette"]')
    if (pal) pal.hidden = state.style === 'trace'
    const copy = $('[data-cmd-copy]')
    if (copy) copy.dataset.copy = ['npm run reel --', ...tokens()].join(' ')
    for (const [k, v] of [['board', state.board], ['style', state.style], ['aspect', state.aspect], ['palette', state.ink]] as const) {
      $$(`[data-pick="${k}"] [data-v]`).forEach((o) => { o.setAttribute('aria-checked', String(o.dataset.v === v)) })
    }
    const trace = state.style === 'trace'
    if (monitorRead) monitorRead.textContent = trace
      ? `Trace · ${b?.name ?? ''} · ${state.aspect} · video render`
      : `Glyph · ${b?.name ?? 'Your board'} · ${state.aspect} · ${state.ink} · drawn live in this tab`
    if (cmdNote) cmdNote.textContent = matchMedia('(hover: hover)').matches ? 'Click any word to change it' : 'Tap any word to change it'
    const takeLabel = $('[data-take-label]')
    if (takeLabel && !takeBtn?.hasAttribute('aria-busy')) rollTo(takeLabel, trace ? 'Download this render' : 'Record a take')
  }
  const monitorOn = () => { const r = monitorStage?.getBoundingClientRect(); return !!r && r.bottom > 0 && r.top < innerHeight }
  const showMonitor = (instant = false) => {
    const trace = state.style === 'trace'
    fitStage()
    if (monitorCanvas) monitorCanvas.hidden = trace
    if (monitorVideo) {
      monitorVideo.hidden = !trace
      if (trace) {
        const tag = state.aspect === '16:9' ? '' : `-${state.aspect.replace(':', 'x')}`
        const src = `/films/trace/${state.board}${tag || '-540'}.mp4`
        if (!monitorVideo.src.endsWith(src)) { monitorVideo.poster = `/films/trace/${state.board}${tag}-poster.webp`; monitorVideo.src = src }
        if (!reduced && monitorOn()) void monitorVideo.play().catch(() => { /* the poster stays */ })
        monitor.pause()
      } else monitorVideo.pause()
    }
    if (!trace) {
      void filmOf(state.board, state.aspect).then((film) => {
        monitor.show(film, { decode: !instant })
        monitor.setView({ rect: frameRect(), zoom: 1.45, cx: 0.5, cy: 0.5, fx: 0.5, fy: 0.5 }, { instant })
        if (reduced) monitor.scrub(240)
        else { monitor.seek(182); if (monitorOn()) monitor.play() }
      })
    }
    paintCmd()
  }
  showMonitor(true)
  new IntersectionObserver(([e]) => {
    const on = e?.isIntersecting === true && !reduced
    if (state.style === 'trace') { if (on) void monitorVideo?.play().catch(() => { /* the poster stays */ }); else monitorVideo?.pause() }
    else if (on) monitor.play()
    else monitor.pause()
  }).observe(monitorStage ?? document.body)
  addEventListener('resize', () => { monitor.setView({ rect: frameRect() }, { instant: true }) })

  const pick = (k: string, v: string) => {
    if (k === 'board') { if (v === state.board) return; state.board = v; if (names.get(v)?.own) state.style = 'glyph' }
    else if (k === 'style') { if (v === state.style) return; if (v === 'trace' && names.get(state.board)?.own) { toast('Trace films render on your machine. Here your board plays as glyphs.'); return } state.style = v as Style }
    else if (k === 'aspect') { if (v === state.aspect) return; state.aspect = v as Aspect }
    else if (k === 'palette') {
      if (v === state.ink) return
      state.ink = v as PaletteId
      try { localStorage.setItem('sr-ink', v) } catch { /* private mode */ }
      monitor.setPalette(state.ink)
      fitStage()
      paintCmd()
      return
    }
    showMonitor()
  }

  /* the pickers are native popovers; they open under their word and close on a pick, Escape or a click away */
  $$('[data-pick]').forEach((pop) => {
    const key = pop.dataset.pick ?? ''
    const opener = $(`[popovertarget="${pop.id}"]`)
    const items = () => $$<HTMLButtonElement>('.pick__o', pop)
    pop.addEventListener('toggle', (e) => {
      if ((e).newState !== 'open' || !opener) return
      const r = opener.getBoundingClientRect()
      const w = pop.offsetWidth, h = pop.offsetHeight
      const below = r.bottom + 10 + h < innerHeight
      pop.style.left = `${clamp(r.left - 6, 16, innerWidth - w - 16)}px`
      pop.style.top = `${below ? r.bottom + 10 : Math.max(16, r.top - 10 - h)}px`
      ;(items().find((o) => o.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus()
    })
    pop.addEventListener('keydown', (e) => {
      const back = e.key === 'ArrowUp'
      if (!back && e.key !== 'ArrowDown') return
      e.preventDefault()
      const list = items()
      const i = list.findIndex((o) => o === document.activeElement)
      list[(i + (back ? -1 : 1) + list.length) % list.length]?.focus()
    })
    pop.addEventListener('click', (e) => {
      const o = (e.target as Element).closest<HTMLButtonElement>('.pick__o')
      if (!o) return
      pop.hidePopover()
      opener?.focus()
      if (o.dataset.own !== undefined) { input?.click(); return }
      pick(key, o.dataset.v ?? '')
    })
  })
  addEventListener('wheel', () => { $$('.pick:popover-open').forEach((p) => { p.hidePopover() }) }, { passive: true })

  /* ---------- take it from the page ---------- */
  const toastEl = $('[data-toast]')
  let toastT = 0
  const toast = (msg: string) => {
    if (!toastEl) return
    toastEl.textContent = msg
    toastEl.dataset.on = ''
    clearTimeout(toastT)
    toastT = window.setTimeout(() => { delete toastEl.dataset.on }, 4200)
  }
  const exportCanvas = (aspect: Aspect) => {
    const [aw = 1, ah = 1] = aspect.split(':').map(Number)
    const c = document.createElement('canvas')
    c.width = aw >= ah ? 1920 : 1080
    c.height = Math.round((c.width * ah) / aw)
    return c
  }
  const fileBase = () => `${(names.get(state.board)?.name ?? 'board').replace(/\W+/g, '-').toLowerCase()}-glyph-${state.aspect.replace(':', 'x')}-${state.ink}`
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href) }, 4000)
  }
  const traceName = () => `${(names.get(state.board)?.name ?? 'board').replace(/\W+/g, '-').toLowerCase()}-trace-${state.aspect.replace(':', 'x')}`
  stillBtn?.addEventListener('click', () => {
    if (state.style === 'trace' && monitorVideo) {
      const c = document.createElement('canvas')
      c.width = monitorVideo.videoWidth
      c.height = monitorVideo.videoHeight
      c.getContext('2d')?.drawImage(monitorVideo, 0, 0)
      c.toBlob((b) => { if (b) { download(b, `${traceName()}.png`); toast(`Saved ${traceName()}.png, a frame of the preview render`) } }, 'image/png')
      return
    }
    void filmOf(state.board, state.aspect).then((film) => {
      const c = exportCanvas(state.aspect)
      drawStill(c, film, monitor.frameNow(), PALETTES[state.ink])
      c.toBlob((b) => { if (b) { download(b, `${fileBase()}.png`); toast(`Saved ${fileBase()}.png`) } }, 'image/png')
    })
  })
  const takeLabel = $('[data-take-label]')
  let recording = false
  takeBtn?.addEventListener('click', () => {
    if (recording) return
    if (state.style === 'trace' && monitorVideo) {
      const a = document.createElement('a')
      a.href = monitorVideo.currentSrc || monitorVideo.src
      a.download = `${traceName()}.mp4`
      a.click()
      toast(`Saved ${traceName()}.mp4, the preview render. The command renders it at full size.`)
      return
    }
    const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m))
    if (!mime) { toast('This browser cannot record a canvas. The command renders the film.'); return }
    void filmOf(state.board, state.aspect).then((film) => {
      recording = true
      takeBtn.setAttribute('aria-busy', 'true')
      const c = exportCanvas(state.aspect)
      const pal = PALETTES[state.ink]
      drawStill(c, film, 0, pal)
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 8e6 })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        recording = false
        takeBtn.removeAttribute('aria-busy')
        if (takeLabel) rollTo(takeLabel, 'Record a take')
        const ext = mime.includes('mp4') ? 'mp4' : 'webm'
        download(new Blob(chunks, { type: mime }), `${fileBase()}.${ext}`)
        toast(`Saved ${fileBase()}.${ext}`)
      }
      rec.start()
      const s0 = performance.now()
      const total = film.tl.totalFrames
      const step = () => {
        const f = Math.floor(((performance.now() - s0) / 1000) * 30)
        if (f >= total) { rec.stop(); return }
        drawStill(c, film, f, pal)
        const label = takeLabel?.querySelector('.roll__a')
        if (label) label.textContent = `Rolling · ${pad((f / total) * 100)}%`
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  })

  /* ---------- your own board: open it or drop it anywhere ---------- */
  const takeFile = (file: File | undefined) => {
    if (!file) return
    if (!/\.kicad_pcb$/i.test(file.name)) { toast('That is not a .kicad_pcb file.'); return }
    if (file.size > 40e6) { toast('That board is over 40 MB. The command line handles it.'); return }
    toast(`Filming ${file.name}…`)
    filmOwnBoard(file).then((b) => {
      names.set(b.id, { name: b.name, file: file.name, parts: b.footprints, own: true })
      const own = $('[data-pick="board"] [data-own]')
      if (own && !$(`[data-pick="board"] [data-v="${CSS.escape(b.id)}"]`)) {
        const o = document.createElement('button')
        o.type = 'button'
        o.className = 'pick__o'
        o.setAttribute('role', 'menuitemradio')
        o.dataset.v = b.id
        const n = document.createElement('span')
        const k = document.createElement('span')
        n.textContent = b.name
        k.className = 'silk'
        k.textContent = `${b.footprints.toLocaleString('en-US')} parts · yours`
        o.append(n, k)
        own.before(o)
      }
      pick('board', b.id)
      $('#make')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
      toast(`Filmed ${b.name}: ${b.footprints.toLocaleString('en-US')} parts became ${b.glyphs.toLocaleString('en-US')} glyphs.`)
    }, (err: unknown) => { toast(`Could not film that board: ${err instanceof Error ? err.message : String(err)}`) })
  }
  input?.addEventListener('change', () => { takeFile(input.files?.[0]); input.value = '' })
  let depth = 0
  const files = (e: DragEvent) => e.dataTransfer?.types.includes('Files') === true
  addEventListener('dragenter', (e) => { if (!files(e)) return; e.preventDefault(); depth++; html.classList.add('dragging') })
  addEventListener('dragover', (e) => { if (files(e)) e.preventDefault() })
  addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) html.classList.remove('dragging') })
  addEventListener('drop', (e) => { if (!files(e)) return; e.preventDefault(); depth = 0; html.classList.remove('dragging'); takeFile(e.dataTransfer?.files[0]) })

}
