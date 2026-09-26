import { safeArea } from '@silk-reel/choreo'
import type { Timeline } from '@silk-reel/choreo'
import { FONT } from './font'

const ease = (x: number): number => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** the window the card lives in: the trace hold beat, or the glyph film's last formation hold */
function titleWindow(tl: Timeline): readonly [number, number] | undefined {
  if (tl.style === 'trace') return tl.scene.beats.hold
  const last = tl.formations[tl.formations.length - 1]
  if (last === undefined) return undefined
  return [last.startPhase, last.endPhase]
}

/**
 * Release title card, bottom-left of the safe-area title band.
 * `fadeAlpha` is the caller's film-level fade (trace fade beat / glyph breath).
 */
export function drawTitle(ctx: CanvasRenderingContext2D, tl: Timeline, p: number, fadeAlpha: number): void {
  const card = tl.title
  if (card === undefined) return
  const win = titleWindow(tl)
  if (win === undefined) return
  const t0 = win[0]
  const aIn = ease((p - t0) / 0.02)
  if (aIn <= 0) return
  const alpha = aIn * fadeAlpha
  if (alpha <= 0.002) return

  const a = safeArea(tl.width, tl.height, true)
  const bandTop = a.y + a.h
  const nameSize = 0.048 * Math.min(tl.width, tl.height)
  const typeK = ease((p - t0) / 0.03)

  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  try {
    ctx.letterSpacing = '0.08em'
  } catch { /* older canvas impls */ }

  // keep the maker's casing — iCEBreaker is not ICEBREAKER
  const name = card.name
  const shown = name.substring(0, Math.ceil(name.length * typeK))
  const nameY = bandTop + 0.045 * tl.height
  ctx.font = `${nameSize}px ${FONT}`
  ctx.fillStyle = tl.palette.silk
  ctx.globalAlpha = alpha
  if (shown.length > 0) ctx.fillText(shown, a.x, nameY)

  if (card.version !== undefined && card.version.length > 0) {
    const ruleY = nameY + 0.018 * tl.height
    ctx.strokeStyle = tl.palette.copperDim
    ctx.lineWidth = 1
    ctx.globalAlpha = alpha * 0.9
    ctx.beginPath()
    ctx.moveTo(a.x, ruleY)
    ctx.lineTo(a.x + 0.12 * tl.width * typeK, ruleY)
    ctx.stroke()
    const shownV = card.version.substring(0, Math.ceil(card.version.length * ease((p - t0 - 0.015) / 0.03)))
    ctx.font = `${nameSize * 0.55}px ${FONT}`
    ctx.globalAlpha = alpha * 0.75
    if (shownV.length > 0) ctx.fillText(shownV, a.x, ruleY + 0.032 * tl.height)
  }
  ctx.restore()
}
