import { boardModel } from '../packages/choreo/test/helpers'
import { compileTimeline } from '../packages/choreo/src/index'
import { sampleTrack } from '../packages/choreo/src/composer'

const tl = compileTimeline(boardModel('icebreaker.kicad_pcb'), {
  style: 'glyph',
  knobs: {},
  seed: 42,
  duration: 'auto',
  output: { width: 1080, height: 1350, fps: 15 }
})
for (const ph of [0.03, 0.05, 0.07, 0.1, 0.13, 0.16, 0.185]) {
  let lit = 0
  for (const t of tl.tracks) lit += sampleTrack(t, ph).filter((a) => a.alpha > 0.05).length
  console.log(`phase ${ph}: ${lit} lit atoms`)
}
const tr = tl.tracks.find((t) => t.glyphId.startsWith('pkg:'))
console.log('knots:', tr?.knots.map((k) => `${k.phase.toFixed(3)}:${k.atoms.length}a${k.transit === true ? 'T' : ''}`).join(' '))
