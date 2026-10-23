import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from '../engine/env'
import { FIGURE } from './figure-data'
import * as D from './figure-draw'
import { fixtureFilm } from '../world/films'
import { ROOM } from '../world/room'
import { drawStill } from '../world/world'
import type { Film } from '../world/world'

gsap.registerPlugin(ScrollTrigger)

/** the footer figure: apart while the footer scrolls in, assembled at the bottom, then the bench cranks the film through the gate */
export function setupFigure() {
  const root = document.querySelector<HTMLElement>('.ft__fig')
  const layer = root?.querySelector<SVGGElement>('.sr-items')
  if (!root || !layer) return
  // the markup is the assembled still at frame 240; under reduced motion it stays exactly that
  if (prefersReducedMotion()) return

  const cam: D.Cam = FIGURE.cam
  const film: D.Film = FIGURE.film
  const { frames, rest, crank: perSecond } = FIGURE.film
  const { explode } = FIGURE
  const count = explode.pieces.length
  const lead = 0.55 / Math.max(1, count - 1)

  const items = [...layer.children].filter((el): el is SVGGElement => el instanceof SVGGElement).map((el) => ({
    el,
    key: Number(el.dataset.k),
    piece: el.dataset.p === undefined ? -1 : Number(el.dataset.p),
    lift: Number(el.dataset.l ?? 0),
    at: 0
  }))
  const chunks = [...root.querySelectorAll<SVGGElement>('.sr-film')].map((el) => ({
    s0: Number(el.dataset.s0),
    s1: Number(el.dataset.s1),
    frames: el.querySelector<SVGPathElement>('.sr-film__frames'),
    perf: el.querySelector<SVGPathElement>('.sr-film__perf')
  }))
  const rollers = FIGURE.rollers.map((r) => ({
    data: r,
    teeth: root.querySelector<SVGPathElement>(`.sr-teeth[data-roller="${r.name}"]`),
    slot: root.querySelector<SVGPathElement>(`.sr-slot[data-roller="${r.name}"]`),
    crank: root.querySelector<SVGGElement>(`[data-crank="${r.name}"]`)
  }))
  const packs = FIGURE.packs.map((p) => ({
    data: p,
    holes: root.querySelector<SVGPathElement>(`.sr-holes[data-pack="${p.name}"]`),
    keys: root.querySelector<SVGPathElement>(`.sr-keys[data-pack="${p.name}"]`)
  }))
  const wheels = [...root.querySelectorAll<SVGGElement>('[data-wheel]')]
  // the screen shows the frame in the gate: the film's own frame, drawn as the counter reads it straight onto a canvas
  // that replaces the still <image> inside the screen's own matrix, so it moves and sorts with the screen head
  const pic = root.querySelector<SVGImageElement>('[data-pic]')
  const hero = root.querySelector<SVGPathElement>('[data-hero]')
  const [heroIn, heroOut] = FIGURE.hero
  const shot = document.createElement('canvas')
  shot.width = 512
  shot.height = 288
  shot.style.cssText = 'display:block;width:100%;height:100%'
  let reel: Film | null = null
  let shown = -1
  function picture() {
    if (!reel) return
    const n = ((Math.floor(s / pitch) % frames) + frames) % frames
    if (n === shown) return
    shown = n
    drawStill(shot, reel, n, ROOM, 1.45)
    hero?.classList.toggle('is-on', n >= heroIn && n <= heroOut)
    if (pic?.isConnected) {
      const view = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject')
      for (const name of ['x', 'y', 'width', 'height', 'transform']) view.setAttribute(name, pic.getAttribute(name) ?? '0')
      view.appendChild(shot)
      pic.replaceWith(view)
    }
  }
  void fixtureFilm('icebreaker', '16:9').then((f) => { reel = f; picture() })

  const pitch = film.pitch
  const shares = new Float64Array(count)
  let s = rest * pitch
  let speed = 0
  let apart = 1
  let target = 1
  let rate = 0
  let order = ''
  let shownApart = -1

  /** each assembly's share of its move: earlier pieces lead going out, so the last out is the first home */
  function place(q: number) {
    for (let i = 0; i < count; i++) {
      const t = Math.min(1, Math.max(0, q * (1 + lead * (count - 1)) - i * lead))
      shares[i] = t * t * (3 - 2 * t)
    }
    for (const item of items) {
      if (item.piece < 0) continue
      const share = shares[item.piece] ?? 0
      if (Math.abs(share - item.at) < 1e-4) continue
      item.at = share
      const m = explode.moves[item.piece]
      if (share < 1e-4 || !m) item.el.removeAttribute('transform')
      else item.el.setAttribute('transform', `translate(${(m[0] * share).toFixed(2)} ${(m[1] * share).toFixed(2)})`)
    }
    // parts that move toward the viewer change places in the painter's order
    const sorted = [...items].sort((a, b) => a.key + a.lift * (a.piece < 0 ? 0 : shares[a.piece] ?? 0) - (b.key + b.lift * (b.piece < 0 ? 0 : shares[b.piece] ?? 0)))
    const next = sorted.map((item) => items.indexOf(item)).join(',')
    if (next !== order) {
      order = next
      const fragment = document.createDocumentFragment()
      for (const item of sorted) fragment.appendChild(item.el)
      layer?.appendChild(fragment)
    }
  }

  // an attribute is written only when its value changed
  const last = new WeakMap<Element, string>()
  const set = (el: Element | null, name: string, value: string) => {
    if (!el || last.get(el) === value) return
    last.set(el, value)
    el.setAttribute(name, value)
  }

  function turn() {
    const adv = ((s % pitch) + pitch) % pitch
    for (const c of chunks) {
      set(c.frames, 'd', D.frames(cam, film, c.s0, c.s1, adv))
      set(c.perf, 'd', D.perfs(cam, film, c.s0, c.s1, adv))
    }
    for (const r of rollers) {
      const angle = D.rollerAngle(r.data, s)
      const drum = { ...r.data, r: r.data.r - 0.3 }
      set(r.teeth, 'd', D.teeth(cam, drum, angle))
      set(r.slot, 'd', D.slot(cam, r.data, angle))
      if (r.crank) {
        const [x, y] = D.crankOffset(cam, r.data, angle)
        set(r.crank, 'transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
      }
    }
    for (const p of packs) {
      const angle = D.packAngle(p.data, s)
      set(p.holes, 'd', D.holes(cam, p.data, angle))
      set(p.keys, 'd', D.keys(cam, p.data, angle))
    }
    const reading = D.wheels(s / pitch, frames, wheels.length)
    wheels.forEach((el, i) => { set(el, 'transform', `translate(0 ${(-(reading[i] ?? 0) * FIGURE.counter.digit).toFixed(1)})`) })
    picture()
  }

  function tick(_time: number, deltaTime: number) {
    const dt = Math.min(deltaTime / 1000, 1 / 30)
    // a critically damped follow of the scroll, so a flick of the wheel still settles calmly
    const w = 1 / 0.32
    rate += (w * w * (target - apart) - 2 * w * rate) * dt
    apart += rate * dt
    if (Math.abs(target - apart) < 1e-4 && Math.abs(rate) < 1e-4) { apart = target; rate = 0 }
    if (apart !== shownApart) { place(apart); shownApart = apart }
    // the crank turns only once the bench is together, and winds up and down over about a second
    const want = apart < 0.01 ? perSecond * pitch : 0
    speed += (want - speed) * (1 - Math.exp(-dt / 0.45))
    if (!held) fling *= Math.exp(-dt / 0.6)
    if (Math.abs(fling) < 0.01) fling = 0
    if (speed > 0.01 || fling !== 0) { s += (speed + (held ? 0 : fling)) * dt; turn() }
  }

  // drag across the bench to crank the film by hand; a flick keeps it turning until the bench takes over again
  const perPx = pitch / 18
  let held = false
  let fling = 0
  let lastX = 0
  let lastT = 0
  root.addEventListener('pointerdown', (e) => {
    if (apart > 0.05) return
    held = true; lastX = e.clientX; lastT = e.timeStamp; fling = 0
    root.setPointerCapture(e.pointerId)
    root.classList.add('is-held')
  })
  root.addEventListener('pointermove', (e) => {
    if (!held) return
    const ds = (e.clientX - lastX) * perPx
    const dt = Math.max(1, e.timeStamp - lastT) / 1000
    fling = fling * 0.6 + (ds / dt) * 0.4
    lastX = e.clientX; lastT = e.timeStamp
    s += ds; turn()
  })
  const release = () => { held = false; root.classList.remove('is-held') }
  root.addEventListener('pointerup', release)
  root.addEventListener('pointercancel', () => { release(); fling = 0 })

  ScrollTrigger.create({
    trigger: root,
    start: 'top bottom',
    end: 'bottom bottom',
    // the home page pins its chapters above the footer; measure after their spacers exist
    refreshPriority: -1,
    onUpdate: (self) => { target = 1 - self.progress },
    onRefresh: (self) => { target = 1 - self.progress }
  })
  apart = target
  place(apart)
  shownApart = apart

  let running = false
  new IntersectionObserver((entries) => {
    const visible = entries[entries.length - 1]?.isIntersecting ?? false
    if (visible && !running) gsap.ticker.add(tick)
    if (!visible && running) gsap.ticker.remove(tick)
    running = visible
  }, { rootMargin: '120px 0px' }).observe(root)
}
