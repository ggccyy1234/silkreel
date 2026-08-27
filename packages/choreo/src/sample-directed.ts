import { ease } from './curves'
import type { ResolvedConfig } from './config'
import type { DirectedKeyframe, UnitTrack } from './types'

export function sampleDirectedKeyframes(track: UnitTrack, frame: number, easingName: ResolvedConfig['knobs']['easing']): DirectedKeyframe | undefined {
  const keyframes = track.keyframes
  if (keyframes.length === 0) return undefined
  const first = keyframes[0]
  const last = keyframes[keyframes.length - 1]
  if (!first || !last) return undefined
  if (frame < first.frame) return { ...first, frame, opacity: 0, glow: 0 }
  if (frame === first.frame) return { ...first }
  if (frame >= last.frame) return { ...last }
  for (let index = 1; index < keyframes.length; index++) {
    const previous = keyframes[index - 1]
    const current = keyframes[index]
    if (!previous || !current || frame > current.frame) continue
    const raw = (frame - previous.frame) / Math.max(1, current.frame - previous.frame)
    const t = ease(raw, easingName)
    const mix = (a: number, b: number): number => a + (b - a) * t
    return {
      frame,
      x: mix(previous.x, current.x),
      y: mix(previous.y, current.y),
      scale: mix(previous.scale, current.scale),
      rotation: mix(previous.rotation, current.rotation),
      opacity: mix(previous.opacity, current.opacity),
      glow: mix(previous.glow, current.glow)
    }
  }
  return { ...last }
}
