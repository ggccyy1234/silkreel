import { gsap } from 'gsap'
import { ASPECT_SIZE, DEMO_CAST_HINTS } from '@silk-reel/choreo'
import type { Aspect, FilmConfig, PaletteId, StyleId, Timeline } from '@silk-reel/choreo'
import { createPreview } from '@silk-reel/render/preview'
import { prefersReducedMotion } from '../engine/env'
import { acts as glyphActs, boards } from '../data/site'
import { rollTo } from '../motion/site'
import type { BoardStats, FromWorker, ToWorker } from './studio.worker'

type Format = 'mp4' | 'gif' | 'webm-alpha' | 'prores-alpha'
interface State {
  board: string; style: StyleId; aspect: Aspect; palette: PaletteId; accent: string; useAccent: boolean
  title: string; version: string; tempo: number; density: number; seed: number; format: Format
}
interface Job { id: string; status: string; progress: number; format: string; error?: string }

/** the live monitor compiles at two thirds of the release size: the same layout, a lighter frame */
const PREVIEW = 2 / 3
const API_KEY = 'sr-api'
const $ = (s: string, root: ParentNode = document) => root.querySelector<HTMLElement>(s)
const pad = (v: number, n = 2) => String(Math.max(0, Math.floor(v))).padStart(n, '0')
const tc = (s: number) => `${pad(s / 60)}:${pad(s % 60)}.${pad((s % 1) * 100)}`
const even = (v: number) => Math.round(v / 2) * 2

export function setupStudio() {
  const root = $('[data-studio]')
  if (!root) return
  const reduced = prefersReducedMotion()
  const form = root
  const canvas = root.querySelector<HTMLCanvasElement>('[data-out]')
  const stage = $('[data-stage]', root)
  const busy = $('[data-busy]', root)
  const busySay = $('[data-busy-say]', root)
  if (!canvas || !stage) return

  const preview = createPreview(canvas)
  const worker = new Worker(new URL('./studio.worker.ts', import.meta.url), { type: 'module' })
  const send = (m: ToWorker) => { worker.postMessage(m) }

  /* ---------- state, from the form and the address bar ---------- */
  const q = new URLSearchParams(location.search)
  const state: State = {
    board: boards.some((b) => b.id === q.get('board')) ? q.get('board') ?? 'icebreaker' : 'icebreaker',
    style: q.get('style') === 'glyph' ? 'glyph' : 'trace',
    aspect: (['4:5', '1:1', '9:16', '16:9'] as const).find((a) => a === q.get('aspect')) ?? '16:9',
    palette: (['mono', 'copper', 'blueprint', 'phosphor'] as const).find((p) => p === q.get('palette')) ?? 'mono',
    accent: /^#[0-9a-f]{6}$/i.test(q.get('accent') ?? '') ? q.get('accent') ?? '#ff4a3d' : '#ff4a3d',
    useAccent: /^#[0-9a-f]{6}$/i.test(q.get('accent') ?? ''),
    title: (q.get('title') ?? '').slice(0, 32),
    version: (q.get('version') ?? '').slice(0, 12),
    tempo: Math.min(1.5, Math.max(0.75, Number(q.get('tempo') ?? 1) || 1)),
    density: Math.min(1.5, Math.max(0.5, Number(q.get('density') ?? 1) || 1)),
    seed: Number.isInteger(Number(q.get('seed'))) && q.get('seed') !== null ? Number(q.get('seed')) : 42,
    format: (['mp4', 'gif', 'webm-alpha', 'prores-alpha'] as const).find((f) => f === q.get('format')) ?? 'mp4'
  }
  const own = new Map<string, { file: string; stats: BoardStats }>()

  const field = <T extends HTMLInputElement>(name: string) => [...form.querySelectorAll<T>(`[name="${name}"]`)]
  const writeForm = () => {
    for (const name of ['style', 'aspect', 'palette', 'format'] as const) for (const el of field(name)) el.checked = el.value === state[name]
    const set = (name: string, v: string) => { const el = field(name)[0]; if (el) el.value = v }
    set('title', state.title); set('version', state.version); set('accent', state.accent)
    set('tempo', String(state.tempo)); set('density', String(state.density)); set('seed', String(state.seed))
    const use = field('useAccent')[0]
    if (use) use.checked = state.useAccent
  }
  const readForm = () => {
    const pick = (name: string) => field(name).find((el) => el.checked)?.value
    state.style = (pick('style') as StyleId | undefined) ?? state.style
    state.aspect = (pick('aspect') as Aspect | undefined) ?? state.aspect
    state.palette = (pick('palette') as PaletteId | undefined) ?? state.palette
    state.format = (pick('format') as Format | undefined) ?? state.format
    const val = (name: string) => field(name)[0]?.value ?? ''
    state.title = val('title').trim(); state.version = val('version').trim()
    state.accent = val('accent'); state.useAccent = field('useAccent')[0]?.checked ?? false
    state.tempo = Number(val('tempo')) || 1; state.density = Number(val('density')) || 1
    const seed = Number(val('seed'))
    state.seed = Number.isFinite(seed) ? Math.max(0, Math.min(99999, Math.round(seed))) : 42
  }

  const config = (scale: number): FilmConfig => {
    const size = ASPECT_SIZE[state.aspect]
    const cast = DEMO_CAST_HINTS[state.board]
    return {
      style: state.style, aspect: state.aspect, seed: state.seed, duration: 'auto',
      knobs: { tempo: state.tempo, ...(state.style === 'glyph' ? { density: state.density } : {}) },
      output: { width: even(size.width * scale), height: even(size.height * scale), fps: 30 },
      ...(cast !== undefined ? { cast } : {}),
      ...(state.style === 'glyph' ? { palette: state.palette } : {}),
      ...(state.useAccent ? { accent: state.accent } : {}),
      ...(state.title ? { title: { name: state.title, ...(state.version ? { version: state.version } : {}) } } : {})
    }
  }

  /* ---------- the command line mirrors every control ---------- */
  const cmdEl = $('[data-cmd]', root)
  const command = () => {
    const file = own.get(state.board)?.file ?? `${state.board}.kicad_pcb`
    const q = (s: string) => (/^[\w.#:-]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`)
    const parts = ['npm run reel --', q(file), '--style', state.style, '--aspect', state.aspect]
    if (state.style === 'glyph') parts.push('--palette', state.palette)
    if (state.useAccent) parts.push('--accent', state.accent)
    if (state.title) parts.push('--title', q(state.title))
    if (state.title && state.version) parts.push('--version', q(state.version))
    if (state.seed !== 42) parts.push('--seed', String(state.seed))
    if (state.tempo !== 1) parts.push('--tempo', String(state.tempo))
    if (state.style === 'glyph' && state.density !== 1) parts.push('--density', String(state.density))
    if (state.format !== 'mp4') parts.push('--format', state.format)
    return parts.join(' ')
  }

  /* ---------- boards: fixtures fetched, yours read from disk; both parsed in the worker ---------- */
  const loaded = new Map<string, Promise<BoardStats>>()
  const waiting = new Map<string, (s: BoardStats) => void>()
  const failing = new Map<string, (e: Error) => void>()
  const load = (id: string, text?: Promise<string>, name = id) => {
    let p = loaded.get(id)
    if (!p) {
      p = new Promise<BoardStats>((resolve, reject) => {
        waiting.set(id, resolve); failing.set(id, reject)
        void (text ?? fetch(`/boards/${id}.kicad_pcb`).then((r) => { if (!r.ok) throw new Error(`no board file for ${id}`); return r.text() }))
          .then((t) => { send({ type: 'load', id, text: t, name }) }, reject)
      })
      loaded.set(id, p)
      p.catch(() => { loaded.delete(id) })
    }
    return p
  }

  let req = 0
  let tl: Timeline | null = null
  const boardWaits = new Map<number, (b: unknown) => void>()
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data
    if (m.type === 'loaded') { waiting.get(m.id)?.(m.stats); waiting.delete(m.id) }
    else if (m.type === 'timeline') { if (m.req === req) takeTimeline(m.timeline) }
    else if (m.type === 'board') { boardWaits.get(m.req)?.(m.board); boardWaits.delete(m.req) }
    else {
      failing.get(m.id)?.(new Error(m.error)); failing.delete(m.id)
      if (m.req === req) showBusy(false)
      note(`That board did not compile: ${m.error}`)
    }
  }

  /* ---------- the busy veil ---------- */
  let busyTimer = 0
  const showBusy = (on: boolean, say = 'Compiling the film') => {
    clearTimeout(busyTimer)
    if (!on) { if (busy) busy.hidden = true; stage.classList.remove('is-busy'); return }
    busyTimer = window.setTimeout(() => { if (busy) busy.hidden = false; if (busySay) busySay.textContent = say; stage.classList.add('is-busy') }, 140)
  }

  /* ---------- compile on every change, keeping the playhead's place in the film ---------- */
  let compileTimer = 0
  const recompile = (now = false) => {
    clearTimeout(compileTimer)
    const go = () => {
      const id = state.board
      showBusy(true, loaded.has(id) ? 'Compiling the film' : 'Reading the board')
      void load(id).then((stats) => {
        paintStats(stats)
        req += 1
        send({ type: 'compile', req, id, config: config(PREVIEW) })
      }, (err: unknown) => { showBusy(false); note(err instanceof Error ? err.message : String(err)) })
    }
    if (now) go(); else compileTimer = window.setTimeout(go, 160)
  }

  const statEls = [...root.querySelectorAll<HTMLElement>('[data-stat]')]
  const paintStats = (s: BoardStats) => {
    for (const el of statEls) {
      const k = el.dataset.stat as keyof BoardStats
      const v = s[k]
      el.textContent = typeof v === 'number' ? v.toLocaleString('en-US') : v
    }
  }

  /* ---------- playback ---------- */
  let frame = 0
  let playing = !reduced
  let drawn = -1
  let dirty = true
  const playBtn = root.querySelector<HTMLButtonElement>('[data-play]')
  const tcEl = $('[data-tc]', root), durEl = $('[data-dur]', root), frameEl = $('[data-frame]', root), beatEl = $('[data-beat]', root), actEl = $('[data-act]', root)
  const track = $('[data-track]', root), fill = $('[data-fill]', root), head = $('[data-head]', root)
  const actsEl = $('[data-acts]', root), cutsEl = $('[data-cuts]', root), beatsEl = $('[data-beats]', root)
  const setPlaying = (on: boolean) => {
    playing = on
    playBtn?.setAttribute('aria-pressed', String(on))
    playBtn?.setAttribute('aria-label', on ? 'Pause' : 'Play')
  }
  setPlaying(playing)

  type Act = { name: string; a: number; b: number }
  let actsNow: Act[] = []
  const actsOf = (t: Timeline): Act[] => {
    if (t.style === 'trace') {
      const a = t.scene.acts
      return [
        { name: 'Draw', a: a.draw[0], b: a.pour[0] },
        { name: 'Build', a: a.pour[0], b: a.reflow[1] },
        { name: 'Breath', a: a.reflow[1], b: a.power[0] },
        { name: 'Power', a: a.power[0], b: a.hold[0] },
        { name: 'Hold', a: a.hold[0], b: 1 }
      ]
    }
    return glyphActs.map((g, i) => ({ name: g.label, a: g.at / 24, b: (glyphActs[i + 1]?.at ?? 24) / 24 }))
  }

  const paintScore = (t: Timeline) => {
    actsNow = actsOf(t)
    if (actsEl) actsEl.innerHTML = actsNow.map((x, i) => `<span class="st__act" style="left:${(x.a * 100).toFixed(3)}%;width:${((x.b - x.a) * 100).toFixed(3)}%" data-i="${String(i)}"><b>${String(i + 1).padStart(2, '0')}</b>${x.b - x.a < 0.09 ? '' : ` ${x.name}`}</span>`).join('')
    if (beatsEl && !beatsEl.childElementCount) beatsEl.innerHTML = Array.from({ length: 25 }, (_, i) => `<i style="left:${((i / 24) * 100).toFixed(3)}%"${i % 4 === 0 ? ' class="is-bar"' : ''}></i>`).join('')
    const cuts = t.style === 'trace' ? t.scene.shots.filter((s) => s.cut === true).map((s) => s.t) : []
    if (cutsEl) cutsEl.innerHTML = cuts.map((c) => `<i style="left:${(c * 100).toFixed(3)}%"><span>Cut</span></i>`).join('')
    track?.setAttribute('aria-valuemax', String(t.totalFrames - 1))
    if (durEl) durEl.textContent = tc(t.durationSeconds)
  }

  const takeTimeline = (next: Timeline) => {
    // held still (reduced motion), the monitor parks on the film's hold, where the board is lit, not on its first frame
    const p = tl ? frame / tl.totalFrames : reduced ? 0.96 : 0
    tl = next
    frame = Math.min(next.totalFrames - 1, p * next.totalFrames)
    stage.parentElement?.style.setProperty('--ar', `${String(next.width)} / ${String(next.height)}`)
    stage.parentElement?.style.setProperty('--arn', String(next.width / next.height))
    stage.style.setProperty('--film-bg', next.palette.bg)
    paintScore(next)
    dirty = true
    showBusy(false)
  }

  const paintRead = (t: Timeline, f: number) => {
    const p = f / t.totalFrames
    if (tcEl) tcEl.textContent = tc(f / t.fps)
    if (frameEl) frameEl.textContent = pad(f, 3)
    // the gate's sprockets advance one hole for every two frames, as the film is held on twos
    stage.parentElement?.style.setProperty('--roll', `${String(-(Math.floor(f / 2) % 1000) * (innerWidth <= 700 ? 20 : 26))}px`)
    if (beatEl) beatEl.textContent = pad(Math.floor(p * 24) + 1)
    const i = actsNow.findIndex((x) => p >= x.a && p < x.b)
    if (actEl) actEl.textContent = actsNow[i]?.name ?? '·'
    actsEl?.querySelectorAll('.st__act').forEach((el, k) => { el.classList.toggle('is-on', k === i) })
    const pc = `${(p * 100).toFixed(3)}%`
    fill?.style.setProperty('width', pc)
    head?.style.setProperty('left', pc)
    track?.setAttribute('aria-valuenow', String(f))
    track?.setAttribute('aria-valuetext', `${tc(f / t.fps)}, beat ${String(Math.floor(p * 24) + 1)}, ${actsNow[i]?.name ?? ''}`)
  }

  let onScreen = true
  new IntersectionObserver(([e]) => { onScreen = e?.isIntersecting ?? true }).observe(stage)
  gsap.ticker.add((_t, dms) => {
    if (!tl || !onScreen || document.hidden) return
    if (playing) { frame = (frame + (Math.min(dms, 100) / 1000) * tl.fps) % tl.totalFrames; dirty = true }
    const f = Math.floor(frame)
    if (!dirty && f === drawn) return
    dirty = false
    drawn = f
    preview.draw(tl, f)
    paintRead(tl, f)
  })

  /* the playhead: drag or click to scrub, keys to step */
  const seekAt = (x: number) => {
    if (!tl || !track) return
    const r = track.getBoundingClientRect()
    frame = Math.max(0, Math.min(tl.totalFrames - 1, ((x - r.left) / r.width) * tl.totalFrames))
    dirty = true
  }
  let wasPlaying = false
  track?.addEventListener('pointerdown', (e) => {
    wasPlaying = playing; setPlaying(false)
    track.setPointerCapture(e.pointerId); seekAt(e.clientX)
    track.classList.add('is-held')
  })
  track?.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) seekAt(e.clientX) })
  const letGo = () => { track?.classList.remove('is-held'); if (wasPlaying) setPlaying(true); wasPlaying = false }
  track?.addEventListener('pointerup', letGo)
  track?.addEventListener('pointercancel', letGo)
  const step = (d: number) => { if (!tl) return; setPlaying(false); frame = (Math.floor(frame) + d + tl.totalFrames) % tl.totalFrames; dirty = true }
  track?.addEventListener('keydown', (e) => {
    if (!tl) return
    if (e.key === 'Home') { e.preventDefault(); setPlaying(false); frame = 0; dirty = true }
    else if (e.key === 'End') { e.preventDefault(); setPlaying(false); frame = tl.totalFrames - 1; dirty = true }
    else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); step((e.key === 'PageUp' ? 1 : -1) * Math.round(tl.totalFrames / 24)) }
  })
  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable]') && !(t instanceof HTMLInputElement && (t.type === 'radio' || t.type === 'range' || t.type === 'checkbox'))) return
    if (e.key === ' ' && !t.closest('button, a, label')) { e.preventDefault(); setPlaying(!playing) }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && (t === document.body || t === track)) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1) }
  })
  playBtn?.addEventListener('click', () => { setPlaying(!playing) })

  /* ---------- controls ---------- */
  const outs = [...root.querySelectorAll<HTMLOutputElement>('[data-out-for]')]
  const accentSay = $('[data-accent-v]', root)
  const paintControls = () => {
    for (const el of root.querySelectorAll<HTMLElement>('[data-only]')) el.hidden = el.dataset.only !== state.style
    for (const o of outs) o.textContent = o.dataset.outFor === 'tempo' ? `${state.tempo.toFixed(2)}×` : state.density.toFixed(2)
    if (accentSay) accentSay.textContent = state.useAccent ? state.accent : 'Palette head'
    for (const b of root.querySelectorAll<HTMLElement>('[data-board]')) {
      const on = b.dataset.board === state.board
      b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1
    }
    // each flag wraps with its value, never between them
    if (cmdEl) cmdEl.replaceChildren(...command().split(/ (?=--\w)/).flatMap((part, i) => {
      const span = document.createElement('span')
      span.className = 'st__flag'
      span.textContent = part
      return i ? [' ', span] : [span]
    }))
    const u = new URL(location.href)
    u.search = ''
    const p = u.searchParams
    if (!own.has(state.board)) p.set('board', state.board)
    p.set('style', state.style); p.set('aspect', state.aspect)
    if (state.style === 'glyph') p.set('palette', state.palette)
    if (state.useAccent) p.set('accent', state.accent)
    if (state.title) p.set('title', state.title)
    if (state.version) p.set('version', state.version)
    if (state.seed !== 42) p.set('seed', String(state.seed))
    if (state.tempo !== 1) p.set('tempo', String(state.tempo))
    if (state.density !== 1) p.set('density', String(state.density))
    if (state.format !== 'mp4') p.set('format', state.format)
    history.replaceState(history.state, '', u)
  }

  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (!t.name) return
    readForm()
    paintControls()
    if (t.name !== 'format') recompile(t.type === 'radio')
  })
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement
    if (t.name === 'useAccent' || t.name === 'seed') { readForm(); paintControls(); recompile(true) }
  })
  $('[data-dice]', root)?.addEventListener('click', () => {
    state.seed = Math.floor(Math.random() * 99999)
    writeForm(); paintControls(); recompile(true)
  })

  const pickBoard = (id: string) => {
    if (id === state.board) return
    state.board = id
    paintControls(); recompile(true)
  }
  root.querySelector('[role="radiogroup"]')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-board]')
    if (b?.dataset.board) pickBoard(b.dataset.board)
  })
  root.querySelector('[role="radiogroup"]')?.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(k)) return
    e.preventDefault()
    const list = [...root.querySelectorAll<HTMLButtonElement>('[data-board]')]
    const i = list.findIndex((b) => b.dataset.board === state.board)
    const next = list[(i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1) + list.length) % list.length]
    if (next?.dataset.board) { pickBoard(next.dataset.board); next.focus() }
  })

  /* your board: drop it on the rail or anywhere on the page */
  const fileInput = root.querySelector<HTMLInputElement>('[data-file]')
  const dropzone = $('[data-dropzone]', root)
  const takeFile = (file: File | undefined) => {
    if (!file) return
    if (!/\.kicad_pcb$/i.test(file.name)) { note('That is not a .kicad_pcb file. Export the board from KiCad and drop that.'); return }
    const id = `own-${String(Date.now())}`
    const name = file.name.replace(/\.kicad_pcb$/i, '')
    showBusy(true, 'Reading your board')
    void load(id, file.text(), name).then((stats) => {
      own.set(id, { file: file.name, stats })
      const list = root.querySelector('[role="radiogroup"]')
      const b = document.createElement('button')
      b.type = 'button'; b.className = 'st__board st__board--own'; b.dataset.board = id; b.setAttribute('role', 'radio')
      b.innerHTML = `<span class="st__bname"></span><span class="st__bwhat">Yours · stays in this tab</span><span class="st__bn">${stats.footprints.toLocaleString('en-US')}<small> parts</small></span>`
      const nm = b.querySelector('.st__bname')
      if (nm) nm.textContent = stats.name
      list?.prepend(b)
      state.board = id
      paintControls(); recompile(true)
      note(`${stats.name} is parsed. It stays in this tab.`)
    }, (err: unknown) => { showBusy(false); note(`That board did not parse: ${err instanceof Error ? err.message : String(err)}`) })
  }
  fileInput?.addEventListener('change', () => { takeFile(fileInput.files?.[0]); fileInput.value = '' })
  dropzone?.addEventListener('click', () => { fileInput?.click() })
  dropzone?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click() } })
  addEventListener('dragover', (e) => { e.preventDefault(); dropzone?.classList.add('is-over') })
  addEventListener('dragleave', (e) => { if (e.relatedTarget === null) dropzone?.classList.remove('is-over') })
  addEventListener('drop', (e) => { e.preventDefault(); dropzone?.classList.remove('is-over'); takeFile(e.dataTransfer?.files[0]) })

  /* ---------- output: the command, a take recorded here, a render on the API ---------- */
  const noteEl = $('[data-note]', root)
  const noteDefault = noteEl?.textContent ?? ''
  let noteTimer = 0
  function note(text: string, hold = 6000) {
    if (!noteEl) return
    noteEl.textContent = text
    noteEl.classList.add('is-said')
    clearTimeout(noteTimer)
    noteTimer = window.setTimeout(() => { noteEl.textContent = noteDefault; noteEl.classList.remove('is-said') }, hold)
  }

  const copyBtn = root.querySelector<HTMLButtonElement>('[data-copy-cmd]')
  copyBtn?.addEventListener('click', () => {
    void navigator.clipboard.writeText(command()).then(() => {
      const label = copyBtn.querySelector<HTMLElement>('[data-roll]')
      if (label) { rollTo(label, 'Copied'); setTimeout(() => { rollTo(label, 'Copy') }, 1600) }
    }, () => { note('The clipboard is blocked here. Select the line and copy it by hand.') })
  })

  const recBtn = root.querySelector<HTMLButtonElement>('[data-record]')
  const recLabel = $('[data-record-label]', root)
  let recording: MediaRecorder | null = null
  recBtn?.addEventListener('click', () => {
    if (!tl) return
    if (recording) { recording.stop(); return }
    if (typeof MediaRecorder === 'undefined' || !('captureStream' in canvas)) { note('This browser cannot record a canvas. Use Render, or the command line.'); return }
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
    const rec = new MediaRecorder(canvas.captureStream(30), { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 12_000_000 })
    const chunks: Blob[] = []
    const t = tl
    const name = `${(own.get(state.board)?.stats.name ?? state.board).replace(/[^\w.-]+/g, '-')}-${state.style}-${state.aspect.replace(':', 'x')}.webm`
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      recording = null
      gsap.ticker.remove(watch)
      recBtn.classList.remove('is-rec')
      if (recLabel) rollTo(recLabel, 'Record in this tab')
      const blob = new Blob(chunks, { type: 'video/webm' })
      if (!blob.size) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = name
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href) }, 4000)
      note(`Saved ${name}: one loop from the live monitor, in WebM.`)
    }
    let last = 0
    const watch = () => {
      if (recLabel) recLabel.querySelector('.roll__a')?.replaceChildren(`Recording ${String(Math.round((frame / t.totalFrames) * 100))}%  ·  stop`)
      if (frame < last) rec.stop()
      last = frame
    }
    frame = 0; dirty = true; setPlaying(true)
    rec.start(250)
    recording = rec
    recBtn.classList.add('is-rec')
    gsap.ticker.add(watch)
  })

  /* the render API on this machine: health lamp, queue, progress, download */
  const apiBase = (() => { try { return localStorage.getItem(API_KEY) ?? 'http://127.0.0.1:3102' } catch { return 'http://127.0.0.1:3102' } })()
  const apiEl = $('[data-api]', root), apiSay = $('[data-api-say]', root)
  const renderBtn = root.querySelector<HTMLButtonElement>('[data-render]')
  const jobsEl = $('[data-jobs]', root)
  let online = false
  const seenKey = 'sr-api-seen'
  const ping = async () => {
    try {
      const r = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(1500) })
      online = r.ok
    } catch { online = false }
    apiEl?.classList.toggle('is-on', online)
    apiEl?.classList.toggle('is-off', !online)
    if (apiSay) apiSay.textContent = online ? 'Render API · online' : 'Render API · offline'
    try { if (online) localStorage.setItem(seenKey, '1') } catch { /* private mode */ }
    if (online) void pollQueue()
    return online
  }
  // a visitor without the API on their machine never sees a failed request: it is checked on demand,
  // or kept watched once it has answered here before
  const watched = (() => { try { return localStorage.getItem(seenKey) === '1' } catch { return false } })()
  if (watched) { void ping(); setInterval(() => { if (!document.hidden) void ping() }, 5000) }
  apiEl?.addEventListener('click', () => {
    void ping().then((on) => { if (!on) note('No render API on this machine. Start it with: npm run start --workspace=@silk-reel/render-api', 9000) })
  })

  const jobs = new Map<string, Job & { label: string }>()
  const paintJobs = () => {
    if (!jobsEl) return
    const list = [...jobs.values()].reverse()
    jobsEl.innerHTML = list.map((j) => {
      const pct = Math.round(j.progress * 100)
      const live = j.status === 'pending' || j.status === 'rendering'
      const end = j.status === 'done'
        ? `<a class="st__job-dl" href="${apiBase}/download/${encodeURIComponent(j.id)}" download>Download ${j.format}</a>`
        : live ? `<button type="button" class="st__job-x" data-cancel="${j.id}">Cancel</button>` : `<span class="st__job-s">${j.status === 'error' ? 'Failed' : 'Cancelled'}</span>`
      return `<li class="st__job is-${j.status}" style="--p:${String(j.progress)}"><span class="st__job-n">${j.label}</span><span class="st__job-p">${live ? `${j.status === 'pending' ? 'Queued' : 'Rendering'} · ${String(pct)}%` : j.status === 'done' ? 'Done' : ''}</span>${end}<i class="st__job-bar" aria-hidden="true"></i>${j.error ? `<span class="st__job-e"></span>` : ''}</li>`
    }).join('')
    list.forEach((j, i) => { const e = jobsEl.querySelectorAll('.st__job-e')[i]; if (e && j.error) e.textContent = j.error })
  }
  const pollQueue = async () => {
    try {
      const r = await fetch(`${apiBase}/queue`)
      const body = (await r.json()) as { jobs: Job[] }
      for (const j of body.jobs) {
        const known = jobs.get(j.id)
        jobs.set(j.id, { ...j, label: known?.label ?? `Job ${j.id.slice(0, 6)} · ${j.format}` })
      }
      paintJobs()
      if ([...jobs.values()].some((j) => j.status === 'pending' || j.status === 'rendering')) setTimeout(() => { void pollQueue() }, 900)
    } catch { /* the lamp says offline on the next ping */ }
  }
  jobsEl?.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cancel]')?.dataset.cancel
    if (id) void fetch(`${apiBase}/job/${encodeURIComponent(id)}/cancel`, { method: 'POST' }).then(() => pollQueue())
  })

  renderBtn?.addEventListener('click', () => { void (online ? Promise.resolve(true) : ping()).then((on) => { if (on) queueRender(); else note('Render needs the render API on this machine: npm run start --workspace=@silk-reel/render-api. Or copy the command and render in your terminal.', 9000) }) })
  const queueRender = () => {
    if (!renderBtn) return
    const id = state.board
    const label = `${own.get(id)?.stats.name ?? boards.find((b) => b.id === id)?.name ?? id} · ${state.style} · ${state.aspect} · ${state.format}`
    const filmConfig = config(1)
    const body = own.has(id)
      ? new Promise<unknown>((resolve) => { const r = Date.now(); boardWaits.set(r, resolve); send({ type: 'board', req: r, id }) }).then((board) => ({ boardJson: board }))
      : Promise.resolve({ demoId: id })
    if (renderBtn.querySelector('[data-render-label]')) rollTo(renderBtn.querySelector<HTMLElement>('[data-render-label]') ?? renderBtn, 'Queued')
    void body.then((src) => fetch(`${apiBase}/render`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...src as object, filmConfig, format: state.format })
    })).then(async (r) => {
      const res = (await r.json()) as { jobId?: string; status?: string; error?: string }
      if (!r.ok || !res.jobId) throw new Error(res.error ?? `render failed (${String(r.status)})`)
      jobs.set(res.jobId, { id: res.jobId, status: res.status ?? 'pending', progress: 0, format: state.format, label })
      paintJobs()
      void pollQueue()
    }).catch((err: unknown) => { note(err instanceof Error ? err.message : String(err)) })
      .finally(() => { setTimeout(() => { const l = renderBtn.querySelector<HTMLElement>('[data-render-label]'); if (l) rollTo(l, 'Render') }, 1200) })
  }

  /* ---------- go ---------- */
  writeForm()
  paintControls()
  recompile(true)
}
