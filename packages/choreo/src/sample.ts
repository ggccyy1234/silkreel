import { ease } from './curves.js'
import type { EasingName, TimelineElement } from './types.js'

export function sampleElement(
  element: TimelineElement,
  easing: EasingName
): Map<number, number> {
  const samples = new Map<number, number>()
  const kfs = [...element.keyframes].sort((a, b) => a.frame - b.frame)
  if (kfs.length === 0) return samples

  const first = kfs[0]
  if (first) {
    const start = Math.max(0, first.frame - 2)
    for (let f = start; f < first.frame; f++) samples.set(f, 0)
  }

  for (let i = 0; i < kfs.length; i++) {
    const cur = kfs[i]
    if (!cur) continue
    samples.set(cur.frame, cur.opacity)
    if (i === kfs.length - 1) break
    const next = kfs[i + 1]
    if (!next) continue
    const segLen = next.frame - cur.frame
    if (segLen <= 1) continue
    const step = Math.max(1, Math.floor(segLen / 8))
    for (let f = cur.frame + 1; f < next.frame; f += step) {
      const t = (f - cur.frame) / segLen
      const eased = ease(t, easing)
      const v = cur.opacity + (next.opacity - cur.opacity) * eased
      samples.set(f, Math.round(v * 10000) / 10000)
    }
  }
  return samples
}
