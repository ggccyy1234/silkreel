import type { TraceTimeline } from '@silk-reel/choreo'

/**
 * The sound of a trace film, synthesised from its own score: nothing is a
 * sample, every hit lands on an event the picture already plays — the hero
 * chip seating, its pins igniting, power flooding, clocks ticking, buses
 * landing as chimes, the stack lifting, the slam, the mask pouring, parts
 * clicking down, and a resolving chord under the hero. Deterministic: the
 * same timeline makes the same waveform.
 */
const SR = 48000

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Bus {
  readonly l: Float32Array
  readonly r: Float32Array
  constructor(readonly n: number) {
    this.l = new Float32Array(n)
    this.r = new Float32Array(n)
  }
  /** add a mono voice starting at t seconds, panned −1..1 */
  add(t: number, voice: Float32Array, gain: number, pan = 0): void {
    const s0 = Math.round(t * SR)
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4)
    const gr = gain * Math.sin(((pan + 1) * Math.PI) / 4)
    for (let i = 0; i < voice.length; i++) {
      const j = s0 + i
      if (j < 0 || j >= this.n) continue
      this.l[j] = (this.l[j] as number) + (voice[i] as number) * gl
      this.r[j] = (this.r[j] as number) + (voice[i] as number) * gr
    }
  }
}

const env = (i: number, n: number, attack: number, curve = 4): number => {
  const t = i / SR
  const a = Math.min(1, t / Math.max(1e-4, attack))
  return a * Math.exp((-curve * i) / n)
}

/** a decaying sine with a pitch fall: thumps and booms */
function thump(f0: number, f1: number, dur: number): Float32Array {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const f = f1 + (f0 - f1) * Math.exp(-u * 8)
    ph += (2 * Math.PI * f) / SR
    out[i] = Math.sin(ph) * env(i, n, 0.002, 5)
  }
  return out
}

/** FM bell: the chime of a bus landing */
function bell(f: number, dur: number, ratio = 3.5, index = 2.2): Float32Array {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const e = env(i, n, 0.003, 6)
    const mod = Math.sin(2 * Math.PI * f * ratio * t) * index * e
    out[i] = Math.sin(2 * Math.PI * f * t + mod) * e
  }
  return out
}

/** a short bright click: ticks, part placements */
function click(f: number, dur: number): Float32Array {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * f * i) / SR) * Math.exp((-i / n) * 9)
  return out
}

/** filtered noise with an envelope and a moving one-pole lowpass: pours, whooshes, bursts */
function noise(dur: number, cutoff: (u: number) => number, amp: (u: number) => number, seed: number, high = false): Float32Array {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  const r = rng(seed)
  let lp = 0
  let lp2 = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const a = 1 - Math.exp((-2 * Math.PI * cutoff(u)) / SR)
    lp += a * (r() * 2 - 1 - lp)
    lp2 += a * (lp - lp2)
    out[i] = (high ? lp - lp2 : lp2) * amp(u)
  }
  return out
}

/** a slow pad of detuned sines: the drone and the resolving chord */
function pad(freqs: number[], dur: number, amp: (u: number) => number): Float32Array {
  const n = Math.round(dur * SR)
  const out = new Float32Array(n)
  for (const f of freqs) {
    for (const d of [-0.18, 0.18]) {
      const ff = f * Math.pow(2, d / 12)
      for (let i = 0; i < n; i++) out[i] = (out[i] as number) + Math.sin((2 * Math.PI * ff * i) / SR) * amp(i / n) / (freqs.length * 2)
    }
  }
  return out
}

/** a small Schroeder room so every hit has a tail */
function reverb(bus: Bus, wet: number): void {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0 }))
  const aps = [225, 556].map((d) => ({ d, buf: new Float32Array(d), i: 0 }))
  const run = (x: Float32Array, spread: number): Float32Array => {
    const y = new Float32Array(x.length)
    const cs = combs.map((c) => ({ ...c, buf: new Float32Array(c.d + spread), d: c.d + spread, i: 0 }))
    const as = aps.map((a) => ({ ...a, buf: new Float32Array(a.d), i: 0 }))
    for (let n = 0; n < x.length; n++) {
      let s = 0
      for (const c of cs) {
        const o = c.buf[c.i] as number
        c.buf[c.i] = (x[n] as number) + o * 0.82
        c.i = (c.i + 1) % c.d
        s += o
      }
      s *= 0.25
      for (const a of as) {
        const o = a.buf[a.i] as number
        const v = s + o * 0.5
        a.buf[a.i] = v
        a.i = (a.i + 1) % a.d
        s = o - v * 0.5
      }
      y[n] = s
    }
    return y
  }
  const wl = run(bus.l, 0)
  const wr = run(bus.r, 23)
  for (let i = 0; i < bus.n; i++) {
    bus.l[i] = (bus.l[i] as number) + (wl[i] as number) * wet
    bus.r[i] = (bus.r[i] as number) + (wr[i] as number) * wet
  }
}

/** D major pentatonic over two octaves: chimes stay consonant whatever order they land in */
const SCALE = [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1318.51, 1479.98, 1760]

export function traceScore(tl: TraceTimeline): { left: Float32Array; right: Float32Array; sampleRate: number } {
  const dur = tl.durationSeconds
  const n = Math.round(dur * SR)
  const bus = new Bus(n)
  const s = tl.scene
  const a = s.acts
  const T = (p: number): number => p * dur
  const panOf = (x: number): number => Math.max(-0.8, Math.min(0.8, (x / tl.width) * 2 - 1))
  const r = rng(tl.seedUsed)

  // the room tone: a low D drone that breathes up through the build and drops out for the slam
  bus.add(0, pad([73.42, 110, 146.83], dur, (u) => {
    const p = u
    const build = Math.min(1, p / 0.1) * (0.5 + 0.5 * Math.min(1, p / a.slam[0]))
    const duck = p > a.slam[0] - 0.014 && p < a.slam[1] + 0.03 ? 0.15 : 1
    return build * duck * (p > 0.97 ? Math.max(0, (1 - p) / 0.03) : 1)
  }), 0.16)

  // I: the hero seats — a soft thump and a glass ping; its pins tick on in a sweep
  bus.add(T(a.land[1]) - 0.005, thump(90, 42, 0.9), 0.55)
  bus.add(T(a.land[1]), bell(1174.66, 1.6, 2.0, 1.2), 0.08)
  for (let i = 0; i < 14; i++) {
    const p = a.heroPads[0] + (i / 13) * (a.heroPads[1] - a.heroPads[0])
    bus.add(T(p), click(3200 + i * 90, 0.03), 0.05, -0.6 + (i / 13) * 1.2)
  }
  // the power planes flood: a rising, opening wash
  bus.add(T(a.flood[0]), noise(T(a.flood[1] - a.flood[0]) + 0.6, (u) => 180 + 2400 * u * u, (u) => Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.9, 11), 0.15)

  // II: clocks tick on the bar lines; buses and pairs chime where they land
  const clocks = s.groups.filter((g) => g.kind === 'clock')
  const lead = clocks[0]
  if (lead !== undefined) for (const p of lead.pulses) bus.add(T(p), click(2600, 0.018), 0.07, 0.3)
  const landings = s.groups.filter((g) => g.kind === 'bus' || g.kind === 'diff').sort((x, y) => x.t + x.d - (y.t + y.d))
  landings.forEach((g, i) => {
    const f = SCALE[i % SCALE.length] as number
    bus.add(T(g.t + g.d), bell(f, 2.2), i === 0 ? 0.2 : 0.09, (r() - 0.5) * 1.2)
  })
  const burstAt = new Set<number>()
  for (const g of s.groups) if (g.kind === 'bus') for (const p of g.pulses) burstAt.add(Math.round(p * 1000))
  for (const p of burstAt) bus.add(T(p / 1000), noise(0.16, () => 5200, (u) => Math.exp(-u * 6), 31 + p, true), 0.12)

  // III: the stack lifts on a rising whoosh, vias sparkle, a breath in — then the slam
  const ex = T(a.explode[0])
  bus.add(ex - 0.15, noise(T(a.explode[1] - a.explode[0]) + 0.5, (u) => 300 + 3500 * u, (u) => Math.sin(Math.PI * u) * 0.8, 41), 0.22)
  for (let i = 0; i < Math.max(2, s.layers.length); i++) bus.add(ex + i * 0.084, bell(SCALE[3 + i] as number, 1.4, 1.5, 0.6), 0.05)
  for (let i = 0; i < 26; i++) {
    const p = a.explode[1] + 0.005 + r() * (a.slam[0] - a.explode[1] - 0.02)
    bus.add(T(p), click(4200 + r() * 2400, 0.012), 0.025, (r() - 0.5) * 1.6)
  }
  const pre = T(a.slam[0] - 0.014)
  bus.add(pre, noise(T(a.slam[1] + 0.014 - a.slam[0]) + 0.02, (u) => 400 + 6000 * u * u, (u) => u * u, 51), 0.35)
  const hit = T(a.slam[1])
  bus.add(hit, thump(70, 28, 2.2), 1.0)
  bus.add(hit, noise(0.5, (u) => 3000 * Math.exp(-u * 5) + 200, (u) => Math.exp(-u * 7), 61), 0.5)

  // IV: the mask pours, the UV cures with a hum, parts click down, and the chord resolves
  bus.add(T(a.mask[0]), noise(T(a.mask[1] - a.mask[0]) + 0.3, () => 1300, (u) => Math.min(1, u * 6) * Math.min(1, (1 - u) * 4) * 0.7, 71), 0.11)
  const cure = new Float32Array(Math.round(T(a.cure[1] - a.cure[0]) * SR) + 4800)
  for (let i = 0; i < cure.length; i++) {
    const t = i / SR
    cure[i] = Math.sin(2 * Math.PI * (2200 + 30 * Math.sin(2 * Math.PI * 7 * t)) * t) * Math.sin((Math.PI * i) / cure.length)
  }
  bus.add(T(a.cure[0]), cure, 0.03)
  const parts = [...s.parts].filter((p) => p.hero !== true).sort((x, y) => x.t - y.t)
  const step = Math.max(1, Math.floor(parts.length / 36))
  parts.forEach((p, i) => {
    if (i % step !== 0) return
    bus.add(T(p.t), click(1400 + 2600 / Math.sqrt(1 + p.z), 0.025), 0.06, panOf(p.x))
  })
  const res = T(a.sweep[0]) - 0.4
  bus.add(res, pad([146.83, 185, 220, 329.63, 440], dur - res, (u) => Math.min(1, u * 3) * (u > 0.82 ? Math.max(0, (1 - u) / 0.18) : 1)), 0.22)
  bus.add(T(a.sweep[0]), noise(T(a.sweep[1] - a.sweep[0]) + 0.4, () => 8500, (u) => Math.sin(Math.PI * u), 81, true), 0.08)

  reverb(bus, 0.3)
  // peak-normalise to −1 dBFS with a soft knee
  let peak = 1e-9
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(bus.l[i] as number), Math.abs(bus.r[i] as number))
  const g = 0.89 / peak
  for (let i = 0; i < n; i++) {
    bus.l[i] = Math.tanh((bus.l[i] as number) * g * 1.1) / Math.tanh(1.1)
    bus.r[i] = Math.tanh((bus.r[i] as number) * g * 1.1) / Math.tanh(1.1)
  }
  return { left: bus.l, right: bus.r, sampleRate: SR }
}

/** 16-bit stereo PCM WAV */
export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Buffer {
  const n = left.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 4, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] as number)) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] as number)) * 32767), 46 + i * 4)
  }
  return buf
}
