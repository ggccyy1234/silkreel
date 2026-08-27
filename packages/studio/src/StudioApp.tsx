import React, { useCallback, useMemo, useState } from 'react'
import type { ActId, FilmConfig, Timeline } from '@silk-reel/choreo'
import { compileTimeline } from '@silk-reel/choreo'
import { Film } from '@silk-reel/render'
import { Player } from '@remotion/player'
import type { PlayerRef } from '@remotion/player'
import type { BoardModel } from '@silk-reel/ingest'
import './workspace.css'
import { DEFAULT_KNOBS, PALETTE_ACCENTS, KNOB_RANGES, SYMMETRY_OPTIONS, DISSOLVE_OPTIONS, EASING_OPTIONS, PALETTE_OPTIONS, DEMO_BOARDS } from './film-config'
import type { StudioKnobs } from './film-config'
import { downloadUrl, pollJob, presentationActOrder, submitExport, summarize, useBoardSources, useDebouncedCallback } from './api'
import type { BoardSummary, ExportJob } from './api'

type Screen = 'landing' | 'workspace'

interface CompiledFilm {
  timeline: Timeline
  warnings: string[]
}

export const StudioApp: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('landing')
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [actOrder, setActOrder] = useState<ActId[]>([])
  const [knobs, setKnobs] = useState<StudioKnobs>(DEFAULT_KNOBS)
  const [seed, setSeed] = useState<number | null>(42)
  const [duration, setDuration] = useState<'auto' | number>('auto')
  const [film, setFilm] = useState<CompiledFilm | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const [exportJob, setExportJob] = useState<ExportJob | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const sources = useBoardSources()

  const openBoard = useCallback((board: BoardModel, fileName: string) => {
    const s = summarize(board, fileName)
    setSummary(s)
    setActOrder(presentationActOrder(s.acts))
    setKnobs(DEFAULT_KNOBS)
    setSeed(42)
    setDuration('auto')
    setFilm(null)
    setExportJob(null)
    setExportError(null)
    setScreen('workspace')
  }, [])

  const config: FilmConfig = useMemo(
    () => ({
      actOrder,
      knobs,
      seed,
      duration,
      output: { width: 1080, height: 1350, fps: 15 }
    }),
    [actOrder, knobs, seed, duration]
  )

  const recompile = useCallback(() => {
    if (!summary) return
    try {
      const timeline = compileTimeline(summary.board, config)
      setFilm({
        timeline,
        warnings: timeline.warnings.map((w) => w.message)
      })
      setCompileError(null)
    } catch (err) {
      setFilm(null)
      setCompileError(err instanceof Error ? err.message : String(err))
    }
  }, [summary, config])

  const debouncedRecompile = useDebouncedCallback(recompile, 250)

  React.useEffect(() => {
    if (screen === 'workspace') debouncedRecompile()
  }, [screen, config, debouncedRecompile])

  const palette = PALETTE_ACCENTS[knobs.palette ?? 'mono']
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent', palette.ink)
  }, [palette.ink])

  const startExport = useCallback(async () => {
    if (!summary) return
    setExportError(null)
    try {
      const jobId = await submitExport({
        boardJson: summary.board,
        filmConfig: { actOrder, knobs, seed, duration, output: { width: 1080, height: 1350, fps: 15 } }
      })
      setExportJob({ jobId, status: 'pending', progress: 0, gatePassed: null, gateDetail: null, error: null })
      const job = await pollJob(jobId)
      setExportJob(job)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }, [summary, actOrder, knobs, seed, duration])

  if (screen === 'landing' || !summary) {
    return (
      <Landing
        onDemo={async (id, label) => {
          const board = await sources.loadDemo(id)
          if (board) openBoard(board, label)
        }}
        onFile={async (file) => {
          const board = await sources.parseFile(file)
          if (board) openBoard(board, file.name)
        }}
        loadingDemo={sources.loadingDemo}
        error={sources.error}
        onDismissError={sources.clearError}
      />
    )
  }

  return (
    <Workspace
      summary={summary}
      film={film}
      compileError={compileError}
      actOrder={actOrder}
      onActOrder={setActOrder}
      knobs={knobs}
      onKnobs={(patch) => {
        setKnobs((prev) => ({ ...prev, ...patch }))
      }}
      seed={seed}
      onSeed={setSeed}
      duration={duration}
      onDuration={setDuration}
      onHome={() => {
        setScreen('landing')
      }}
      exportJob={exportJob}
      exportError={exportError}
      onExport={startExport}
    />
  )
}

const Landing: React.FC<{
  onDemo: (id: string, label: string) => Promise<void>
  onFile: (file: File) => Promise<void>
  loadingDemo: string | null
  error: string | null
  onDismissError: () => void
}> = ({ onDemo, onFile, loadingDemo, error, onDismissError }) => {
  const [dragOver, setDragOver] = useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)

  return (
    <main className="landing">
      <header className="landing-header">
        <span className="wordmark">silk reel</span>
        <span className="tagline">pcb boards, cut to film</span>
      </header>
      <section
        className={`drop-zone${dragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => {
          setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) void onFile(file)
        }}
      >
        <p className="drop-hint">drop a .kicad_pcb, or</p>
        <button onClick={() => {
          fileInput.current?.click()
        }}>choose file</button>
        <input
          ref={fileInput}
          type="file"
          accept=".kicad_pcb,.kicad_mod,.gtl,.gbl,.gml,.gko,.drl,.drd"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onFile(file)
          }}
        />
      </section>
      {error !== null && (
        <div className="error-strip" role="alert">
          <span>{error}</span>
          <button className="ghost" onClick={onDismissError} aria-label="dismiss error">dismiss</button>
        </div>
      )}
      <section className="demo-grid" aria-label="demo boards">
        {DEMO_BOARDS.map((demo) => (
          <button
            key={demo.id}
            className="demo-card"
            onClick={() => {
              void onDemo(demo.id, demo.label)
            }}
            disabled={loadingDemo !== null}
          >
            <span className="demo-label">{demo.label}</span>
            <span className="demo-detail">{loadingDemo === demo.id ? 'loading…' : demo.detail}</span>
            <span className="demo-cta">open →</span>
          </button>
        ))}
      </section>
    </main>
  )
}

interface WorkspaceProps {
  summary: BoardSummary
  film: CompiledFilm | null
  compileError: string | null
  actOrder: ActId[]
  onActOrder: (order: ActId[]) => void
  knobs: StudioKnobs
  onKnobs: (patch: Partial<StudioKnobs>) => void
  seed: number | null
  onSeed: (seed: number | null) => void
  duration: 'auto' | number
  onDuration: (duration: 'auto' | number) => void
  onHome: () => void
  exportJob: ExportJob | null
  exportError: string | null
  onExport: () => Promise<void>
}

const Workspace: React.FC<WorkspaceProps> = (props) => {
  const { summary, film, compileError } = props
  return (
    <div className="workspace">
      <header className="topbar">
        <button className="ghost" onClick={props.onHome}>← boards</button>
        <span className="board-name">{summary.fileName}</span>
        <span className="board-meta">{summary.layerCount} layers · {summary.elementCount.toLocaleString()} elements</span>
        <ExportControl job={props.exportJob} error={props.exportError} onExport={props.onExport} />
      </header>
      <div className="workspace-body">
        <section className="player-pane" aria-label="preview">
          {compileError !== null ? (
            <div className="pane-error" role="alert">{compileError}</div>
          ) : film === null ? (
            <div className="pane-loading">compiling…</div>
          ) : (
            <PlayerPane timeline={film.timeline} board={summary.board} />
          )}
        </section>
        <aside className="controls-pane">
          {film !== null && film.warnings.length > 0 && (
            <details className="warnings">
              <summary>{film.warnings.length} compile note{film.warnings.length === 1 ? '' : 's'}</summary>
              <ul>
                {film.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
          <ActList acts={summary.acts} order={props.actOrder} onChange={props.onActOrder} compiledIds={film?.timeline.cast.map((unit) => unit.sourceAct) ?? []} />
          <KnobPanel knobs={props.knobs} onKnobs={props.onKnobs} seed={props.seed} onSeed={props.onSeed} duration={props.duration} onDuration={props.onDuration} />
        </aside>
      </div>
    </div>
  )
}

const PlayerPane: React.FC<{ timeline: Timeline; board: BoardModel }> = ({ timeline, board }) => {
  const playerRef = React.useRef<PlayerRef>(null)

  return (
    <div className="player-wrap">
      <Player
        ref={playerRef}
        component={Film}
        inputProps={{ timeline, board }}
        durationInFrames={timeline.totalFrames}
        fps={timeline.fps}
        compositionWidth={timeline.width}
        compositionHeight={timeline.height}
        style={{ width: '100%', maxHeight: 'calc(100dvh - 160px)', aspectRatio: `${timeline.width} / ${timeline.height}` }}
        controls
        loop
        acknowledgeRemotionLicense
      />
      <ActRibbon timeline={timeline} playerRef={playerRef} />
    </div>
  )
}

const ActRibbon: React.FC<{ timeline: Timeline; playerRef: React.RefObject<PlayerRef | null> }> = ({ timeline, playerRef }) => {
  const total = timeline.totalFrames
  const beats = timeline.directedBeats
  const shotLabels: Record<string, string> = {
    'black-breath': 'breath',
    'vertical-seed': 'seed',
    'cross-collapse': 'cross',
    'radial-gate': 'radial',
    'bilateral-tower': 'tower',
    'corner-bridge': 'bridge',
    'horizontal-study': 'study',
    'pad-coda': 'coda',
    'black-cut': 'cut'
  }
  return (
    <div className="act-ribbon" role="group" aria-label="shot map; click a shot to jump to it">
      {timeline.shots.map((shot, i) => (
        <button
          key={shot.id}
          className={`act-block shot-${shot.id}`}
          style={{
            width: `${((shot.endFrame - shot.startFrame + 1) / total) * 100}%`,
            background: i % 2 === 0 ? '#2e2e2e' : '#383838',
            border: 'none',
            borderRadius: 0,
            padding: 0,
            cursor: 'pointer'
          }}
          onClick={() => {
            playerRef.current?.seekTo(shot.startFrame)
          }}
          title={`${shot.id}: frames ${shot.startFrame}–${shot.endFrame}`}
        >
          {beats
            .filter((b) => b.frame >= shot.startFrame && b.frame <= shot.endFrame)
            .map((b) => (
              <span
                key={b.frame}
                className="beat-mark"
                aria-hidden="true"
                style={{ left: `${((b.frame - shot.startFrame) / (shot.endFrame - shot.startFrame + 1)) * 100}%` }}
              />
            ))}
          <span className="act-label">{shotLabels[shot.id] ?? shot.id}</span>
        </button>
      ))}
    </div>
  )
}

const ActList: React.FC<{ acts: ActId[]; order: ActId[]; onChange: (order: ActId[]) => void; compiledIds: string[] }> = ({ acts, order, onChange, compiledIds }) => {
  const dragIndex = React.useRef<number | null>(null)
  const move = (from: number, to: number): void => {
    const next = [...order]
    const [item] = next.splice(from, 1)
    if (item === undefined) return
    next.splice(to, 0, item)
    onChange(next)
  }
  return (
    <section className="panel">
      <h2>acts</h2>
      <ol className="act-list" aria-label="act order, drag to reorder">
        {order.map((act, i) => {
          const compiled = compiledIds.includes(act)
          return (
            <li
              key={act}
              draggable
              onDragStart={() => { dragIndex.current = i }}
              onDragOver={(e) => {
                e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex.current !== null && dragIndex.current !== i) move(dragIndex.current, i)
                dragIndex.current = null
              }}
              className={`act-row${compiled ? '' : ' act-empty'}`}
            >
              <span className="act-grip" aria-hidden="true">⠿</span>
              <span className="act-name">{act}</span>
              {!compiled && <span className="act-flag" title="no elements land in this act">empty</span>}
            </li>
          )
        })}
      </ol>
      {acts.some((a) => !order.includes(a)) && (
        <button
          className="ghost"
          onClick={() => {
            onChange([...order, ...acts.filter((a) => !order.includes(a))])
          }}
        >
          restore missing layers
        </button>
      )}
    </section>
  )
}

const KnobPanel: React.FC<{
  knobs: StudioKnobs
  onKnobs: (patch: Partial<StudioKnobs>) => void
  seed: number | null
  onSeed: (seed: number | null) => void
  duration: 'auto' | number
  onDuration: (duration: 'auto' | number) => void
}> = ({ knobs, onKnobs, seed, onSeed, duration, onDuration }) => {
  const rangeKnobs: Array<{ key: keyof typeof KNOB_RANGES; label: string }> = [
    { key: 'rhythmDensity', label: 'rhythm density' },
    { key: 'beatCount', label: 'beats' },
    { key: 'beatIntensity', label: 'beat intensity' },
    { key: 'seedPairs', label: 'seed pairs' },
    { key: 'glow', label: 'glow' },
    { key: 'flicker', label: 'flicker' },
    { key: 'grain', label: 'grain' },
    { key: 'exposure', label: 'exposure' }
  ]
  return (
    <section className="panel">
      <h2>knobs</h2>
      <div className="knob-grid">
        <div className="field">
          <label htmlFor="knob-palette">palette</label>
          <select
            id="knob-palette"
            value={knobs.palette ?? 'mono'}
            onChange={(e) => {
              onKnobs({ palette: e.target.value as Exclude<StudioKnobs['palette'], undefined> })
            }}
          >
            {PALETTE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="knob-symmetry">symmetry</label>
          <select
            id="knob-symmetry"
            value={knobs.symmetry ?? 'auto'}
            onChange={(e) => {
              onKnobs({ symmetry: e.target.value as Exclude<StudioKnobs['symmetry'], undefined> })
            }}
          >
            {SYMMETRY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="knob-dissolve">dissolve</label>
          <select
            id="knob-dissolve"
            value={knobs.dissolveStyle ?? 'center-out'}
            onChange={(e) => {
              onKnobs({ dissolveStyle: e.target.value as Exclude<StudioKnobs['dissolveStyle'], undefined> })
            }}
          >
            {DISSOLVE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="knob-easing">easing</label>
          <select
            id="knob-easing"
            value={knobs.easing ?? 'expo-out'}
            onChange={(e) => {
              onKnobs({ easing: e.target.value as Exclude<StudioKnobs['easing'], undefined> })
            }}
          >
            {EASING_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        {rangeKnobs.map(({ key, label }) => {
          const range = KNOB_RANGES[key]
          const value = knobs[key] ?? DEFAULT_KNOBS[key] ?? range.min
          const decimals = range.step < 1 ? 2 : 0
          return (
            <div className="field range-field" key={key}>
              <label htmlFor={`knob-${key}`}>{label}</label>
              <div className="range-row">
                <input
                  id={`knob-${key}`}
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={value}
                  onChange={(e) => {
                    onKnobs({ [key]: Number(e.target.value) })
                  }}
                />
                <output className="range-value">{value.toFixed(decimals)}</output>
              </div>
            </div>
          )
        })}
        <div className="field">
          <label htmlFor="knob-seed">seed</label>
          <div className="range-row">
            <input
              id="knob-seed"
              type="number"
              value={seed ?? ''}
              placeholder="random each render"
              onChange={(e) => {
                const raw = e.target.value
                onSeed(raw === '' ? null : Math.floor(Number(raw)))
              }}
            />
            <button
              className="ghost"
              aria-label="randomize seed"
              title="randomize seed"
              onClick={() => {
                onSeed(Math.floor(Math.random() * 1_000_000))
              }}
            >
              ⟳
            </button>
            <button
              className="ghost"
              aria-label="clear seed"
              title="clear seed"
              onClick={() => {
                onSeed(null)
              }}
            >
              ✕
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="knob-duration">duration (s)</label>
          <div className="range-row">
            <input
              id="knob-duration"
              type="number"
              min={6}
              max={20}
              step={0.5}
              value={duration === 'auto' ? '' : duration}
              placeholder="auto"
              onChange={(e) => {
                const raw = e.target.value
                onDuration(raw === '' ? 'auto' : Number(raw))
              }}
            />
            <button className="ghost" onClick={() => {
              onDuration('auto')
            }}>auto</button>
          </div>
        </div>
      </div>
    </section>
  )
}

const ExportControl: React.FC<{ job: ExportJob | null; error: string | null; onExport: () => Promise<void> }> = ({ job, error, onExport }) => {
  return (
    <div className="export-control">
      {error !== null && <span className="export-error" role="alert">{error}</span>}
      {job === null && (
        <button className="primary" onClick={() => {
          void onExport()
        }}>export film</button>
      )}
      {job !== null && job.status !== 'done' && job.status !== 'error' && (
        <span className="export-status" role="status">{job.status} {job.progress > 0 ? `${job.progress}%` : '…'}</span>
      )}
      {job?.status === 'error' && <span className="export-error" role="alert">{job.error ?? 'render failed'}</span>}
      {job?.status === 'done' && (
        <>
          {job.gatePassed !== null && (
            <span className={`gate-chip ${job.gatePassed ? 'gate-ok' : 'gate-warn'}`} title={job.gateDetail ?? ''}>
              gate {job.gatePassed ? 'pass' : 'advisory'}
            </span>
          )}
          <a className="button-link" href={downloadUrl(job.jobId)}>download</a>
          <button className="ghost" onClick={() => {
            void onExport()
          }}>again</button>
        </>
      )}
    </div>
  )
}
