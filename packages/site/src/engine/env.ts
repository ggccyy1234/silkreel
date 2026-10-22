export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
export const isTouch = () => matchMedia('(hover: none), (pointer: coarse)').matches
export const isMobile = () => matchMedia('(max-width: 767px)').matches

// seat: a part set on paste (quick drop, long settle). snap: the reflow pull to square.
export const ease = {
  out: 'expo.out',
  inOut: 'expo.inOut',
  soft: 'power3.out',
  seat: 'cubic-bezier(0.2, 0.9, 0.1, 1)'
} as const
