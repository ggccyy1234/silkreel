import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { prefersReducedMotion } from './env'

gsap.registerPlugin(ScrollTrigger)

let lenis: Lenis | null = null
const listeners = new Set<(s: ScrollState) => void>()

type ScrollState = { y: number }
const state: ScrollState = { y: 0 }

export function initScroll() {
  if (lenis || prefersReducedMotion()) {
    if (!lenis) addEventListener('scroll', nativeTick, { passive: true })
    return
  }
  lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1.2, anchors: true })
  lenis.on('scroll', (l: Lenis) => {
    state.y = l.scroll
    ScrollTrigger.update()
    listeners.forEach((fn) => { fn(state); })
  })
  gsap.ticker.add((time) => lenis?.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
}

function nativeTick() {
  state.y = scrollY
  listeners.forEach((fn) => { fn(state); })
}

export const onScroll = (fn: (s: ScrollState) => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
