// Sound is off until the visitor turns it on. UI sounds are the film's own CC0 recordings.
type Name = 'switch' | 'click-1' | 'click-2' | 'seat'

const KEY = 'sr-sound'
let ctx: AudioContext | null = null
const buffers = new Map<Name, Promise<AudioBuffer>>()
const listeners = new Set<(on: boolean) => void>()

export const soundOn = () => typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'

export function setSound(on: boolean) {
  localStorage.setItem(KEY, on ? '1' : '0')
  if (on) ctx ??= new AudioContext()
  void ctx?.resume()
  listeners.forEach((fn) => { fn(on); })
}

export function onSound(fn: (on: boolean) => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function load(name: Name, c: AudioContext): Promise<AudioBuffer> {
  let b = buffers.get(name)
  if (!b) {
    b = fetch(`/sound/${name}.mp3`).then((r) => r.arrayBuffer()).then((a) => c.decodeAudioData(a))
    buffers.set(name, b)
  }
  return b
}

export function play(name: Name, gain = 0.6) {
  if (!soundOn()) return
  ctx ??= new AudioContext()
  const c = ctx
  void load(name, c).then((buf) => {
    const src = c.createBufferSource()
    const g = c.createGain()
    g.gain.value = gain
    src.buffer = buf
    src.connect(g).connect(c.destination)
    src.start()
  })
}
