import React, { useCallback, useMemo, useState } from 'react'
import type { FilmConfig, Timeline } from '@silk-reel/choreo'
import { Film } from '@silk-reel/render'
import { Player } from '@remotion/player'
import type { PlayerRef } from '@remotion/player'
import type { BoardModel } from '@silk-reel/ingest'
import './workspace.css'
import { compileStudioFilm, DEFAULT_KNOBS, KNOB_RANGES, DEMO_BOARDS } from './film-config'
import type { StudioKnobs } from './film-config'
import { cancelJob, downloadUrl, pollJob, submitExport, summarize, useBoardSources, useDebouncedCallback } from './api'
import type { BoardSummary, ExportJob } from './api'

type Screen = 'landing' | 'workspace'

type CompiledFilm = ReturnType<typeof compileStudioFilm>

type ExportState =
  | { status: 'submitting' }
  | { status: 'rendering'; job: ExportJob }
  | { status: 'completed'; job: ExportJob }
  | { status: 'cancelled' }
  | { status: 'failed'; job: ExportJob | null; error: string }

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function stateForExportJob(job: ExportJob): ExportState {
  if (job.status === 'done') return { status: 'completed', job }
  if (job.status === 'error') return { status: 'failed', job, error: job.error ?? 'render failed' }
  if (job.status === 'cancelled') return { status: 'cancelled' }
  return { status: 'rendering', job }
}

export const StudioApp: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('landing')
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [knobs, setKnobs] = useState<StudioKnobs>(DEFAULT_KNOBS)
  const [seed, setSeed] = useState<number | null>(42)
  const [duration, setDuration] = useState<'auto' | number>('auto')
  const [film, setFilm] = useState<CompiledFilm | null>(null)
  const [compileError, setCompileError] = useState<string | null>(null)
  const [compileStale, setCompileStale] = useState(false)
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const exportControllerRef = React.useRef<AbortController | null>(null)
  const exportJobIdRef = React.useRef<string | null>(null)
  const exportInFlightRef = React.useRef(false)
  const sources = useBoardSources()

  const cancelExport = useCallback(async (showResult: boolean) => {
    const jobId = exportJobIdRef.current
    exportControllerRef.current?.abort()
    exportControllerRef.current = null
    exportJobIdRef.current = null
    exportInFlightRef.current = false
    if (showResult) setExportState({ status: 'cancelled' })
    if (jobId === null) {
      return
    }
    try {
      await cancelJob(jobId)
    } catch (error) {
      if (showResult) {
        setExportState({ status: 'failed', job: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }, [])

  React.useEffect(() => () => {
    void cancelExport(false)
  }, [cancelExport])

  const openBoard = useCallback((board: BoardModel, fileName: string) => {
    void cancelExport(false)
    setSummary(summarize(board, fileName))
    setKnobs(DEFAULT_KNOBS)
    setSeed(42)
    setDuration('auto')
    setFilm(null)
    setCompileError(null)
    setCompileStale(true)
    setExportState(null)
    setScreen('workspace')
  }, [cancelExport])

  const config: FilmConfig = useMemo(
    () => ({
      knobs,
      seed,
      duration,
      output: { width: 1080, height: 1350, fps: 15 }
    }),
    [knobs, seed, duration]
  )

  React.useEffect(() => {
    if (!exportInFlightRef.current) setExportState(null)
  }, [config])

  const recompile = useCallback(() => {
    if (!summary) return
    try {
      setFilm(compileStudioFilm(summary.board, config))
      setCompileError(null)
      setCompileStale(false)
    } catch (err) {
      setFilm(null)
      setCompileError(err instanceof Error ? err.message : String(err))
      setCompileStale(false)
    }
  }, [summary, config])

  const debouncedRecompile = useDebouncedCallback(recompile, 250)

  React.useEffect(() => {
    if (screen !== 'workspace') return
    setCompileStale(true)
    setCompileError(null)
    debouncedRecompile()
  }, [screen, config, debouncedRecompile])

  const startExport = useCallback(async () => {
    if (!summary || !film || compileStale || exportInFlightRef.current) return
    const controller = new AbortController()
    exportControllerRef.current = controller
    exportInFlightRef.current = true
    setExportState({ status: 'submitting' })
    let currentJob: ExportJob | null = null
    try {
      const jobId = await submitExport({
        boardJson: summary.board,
        filmConfig: film.config
      }, controller.signal)
      if (exportControllerRef.current !== controller) return
      exportJobIdRef.current = jobId
      currentJob = { jobId, status: 'pending', progress: 0, gatePassed: null, gateDetail: null, error: null }
      setExportState({ status: 'rendering', job: currentJob })
      const job = await pollJob(jobId, {
        signal: controller.signal,
        onUpdate: (nextJob) => {
          if (exportControllerRef.current !== controller) return
          currentJob = nextJob
          setExportState(stateForExportJob(nextJob))
        }
      })
      if (exportControllerRef.current === controller) setExportState(stateForExportJob(job))
    } catch (err) {
      if (isAbortError(err) || exportControllerRef.current !== controller) return
      setExportState({
        status: 'failed',
        job: currentJob,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      if (exportControllerRef.current === controller) {
        exportControllerRef.current = null
        exportJobIdRef.current = null
        exportInFlightRef.current = false
      }
    }
  }, [summary, film, compileStale])

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
        parsingFile={sources.parsingFile}
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
      compileStale={compileStale}
      knobs={knobs}
      onKnobs={(patch) => {
        setKnobs((prev) => ({ ...prev, ...patch }))
      }}
      seed={seed}
      onSeed={setSeed}
      duration={duration}
      onDuration={setDuration}
      onHome={() => {
        void cancelExport(false)
        setExportState(null)
        setScreen('landing')
      }}
      exportState={exportState}
      onExport={startExport}
      onCancelExport={() => {
        void cancelExport(true)
      }}
    />
  )
}

const Landing: React.FC<{
  onDemo: (id: string, label: string) => Promise<void>
  onFile: (file: File) => Promise<void>
  loadingDemo: string | null
  parsingFile: boolean
  error: string | null
  onDismissError: () => void
}> = ({ onDemo, onFile, loadingDemo, parsingFile, error, onDismissError }) => {
  const [dragOver, setDragOver] = useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const busy = loadingDemo !== null || parsingFile

  return (
    <main className="landing">
      <header className="landing-header">
        <div>
          <span className="landing-kicker">procedural pcb film studio</span>
          <h1 className="wordmark">silk reel</h1>
        </div>
        <p className="tagline">Real board geometry, choreographed into looping glyph films. The source stays yours.</p>
        <div className="lab-status" aria-label="studio format">
          <span>1080 × 1350</span>
          <span>15 fps</span>
          <span>h.264</span>
        </div>
      </header>
      <div className="intake-grid">
        <section
          className={`drop-zone${dragOver ? ' drag-over' : ''}`}
          aria-busy={parsingFile}
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
            if (busy) return
            const file = e.dataTransfer.files[0]
            if (file) void onFile(file)
          }}
        >
          <span className="intake-number">source</span>
          <div className="intake-copy">
            <strong>Load a board</strong>
            <p>Drop a .kicad_pcb</p>
          </div>
          <button className="intake-button" disabled={busy} onClick={() => {
            fileInput.current?.click()
          }}>{parsingFile ? 'parsing…' : 'choose file'}</button>
          <input
            ref={fileInput}
            type="file"
            accept=".kicad_pcb,.gtl,.gbl,.gml,.gko,.gts,.gbs,.gto,.gbo,.gtp,.gbp,.drl,.drd,.xln,.cmp,.sol,.gpi"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onFile(file)
              e.currentTarget.value = ''
            }}
          />
        </section>
        <aside className="format-note" aria-label="supported workflow">
          <span>ingest</span><strong>KiCad PCB</strong>
          <span>film</span><strong>glyph loop</strong>
          <span>output</span><strong>MP4 + gate</strong>
          <p>Gerber sets join the pipeline in m4.</p>
        </aside>
      </div>
      {error !== null && (
        <div className="error-strip" role="alert">
          <span>{error}</span>
          <button className="ghost" onClick={onDismissError} aria-label="dismiss error">dismiss</button>
        </div>
      )}
      <div className="demo-heading">
        <span>bench stock</span>
        <span>start from a known board</span>
      </div>
      <section className="demo-grid" aria-label="demo boards">
        {DEMO_BOARDS.map((demo, index) => (
          <button
            key={demo.id}
            className={`demo-card demo-card-${index + 1}`}
            onClick={() => {
              void onDemo(demo.id, demo.label)
            }}
            disabled={busy}
          >
            <span className="demo-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="demo-plot" aria-hidden="true"><i /><i /><i /><i /></span>
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
  compileStale: boolean
  knobs: StudioKnobs
  onKnobs: (patch: Partial<StudioKnobs>) => void
  seed: number | null
  onSeed: (seed: number | null) => void
  duration: 'auto' | number
  onDuration: (duration: 'auto' | number) => void
  onHome: () => void
  exportState: ExportState | null
  onExport: () => Promise<void>
  onCancelExport: () => void
}

const Workspace: React.FC<WorkspaceProps> = (props) => {
  const { summary, film, compileError } = props
  const exportBusy = props.exportState?.status === 'submitting' || props.exportState?.status === 'rendering'
  return (
    <main className="workspace">
      <header className="topbar">
        <button className="ghost" onClick={props.onHome}>← boards</button>
        <h1 className="board-name">{summary.fileName}</h1>
        <span className="board-meta">{summary.layerCount} source layers · {summary.elementCount.toLocaleString()} primitives</span>
        <ExportControl state={props.exportState} onExport={props.onExport} onCancel={props.onCancelExport} disabled={props.compileStale || film === null} />
      </header>
      <div className="workspace-body">
        <section className="player-pane" aria-label="preview">
          {compileError !== null ? (
            <div className="pane-error" role="alert">{compileError}</div>
          ) : film === null ? (
            <div className="pane-loading" role="status">compiling…</div>
          ) : (
            <PlayerPane timeline={film.timeline} stale={props.compileStale} />
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
          <BoardLedger summary={summary} elementCount={film !== null && film.timeline.style === 'glyph' ? film.timeline.cast.length : 0} />
          <KnobPanel
            knobs={props.knobs}
            onKnobs={props.onKnobs}
            seed={props.seed}
            onSeed={props.onSeed}
            duration={props.duration}
            onDuration={props.onDuration}
            disabled={exportBusy}
          />
        </aside>
      </div>
    </main>
  )
}

const BoardLedger: React.FC<{ summary: BoardSummary; elementCount: number }> = ({ summary, elementCount }) => (
  <section className="panel board-ledger" aria-labelledby="board-ledger-title">
    <div className="panel-heading">
      <h2 id="board-ledger-title">board inventory</h2>
      <span>{elementCount.toLocaleString()} film elements</span>
    </div>
    <dl className="ledger-grid">
      <div><dt>footprints</dt><dd>{summary.footprintCount}</dd></div>
      <div><dt>pads</dt><dd>{summary.padCount}</dd></div>
      <div><dt>traces</dt><dd>{summary.traceCount}</dd></div>
      <div><dt>zones</dt><dd>{summary.zoneCount}</dd></div>
      <div><dt>silk marks</dt><dd>{summary.silkMarkCount}</dd></div>
      <div><dt>vias</dt><dd>{summary.viaCount}</dd></div>
      <div><dt>drills</dt><dd>{summary.drillCount}</dd></div>
      <div><dt>nets</dt><dd>{summary.netCount}</dd></div>
    </dl>
    <p className="layer-ledger" title={summary.layerNames.join(', ')}>{summary.layerNames.join(' · ')}</p>
  </section>
)

const PlayerPane: React.FC<{ timeline: Timeline; stale: boolean }> = ({ timeline, stale }) => {
  const playerRef = React.useRef<PlayerRef>(null)
  const posterChosen = React.useRef(false)
  const currentFrameRef = React.useRef(0)
  const [currentFrame, setCurrentFrame] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)

  React.useEffect(() => {
    const player = playerRef.current
    if (player === null) return

    setPlaying(player.isPlaying())
    if (!posterChosen.current) {
      const formations = timeline.style === 'glyph' ? timeline.formations : []
      const quad = formations.find((formation) => formation.id === 'quad') ?? formations[formations.length - 1]
      const posterFrame = Math.floor(((quad?.startPhase ?? 0) + (quad?.endPhase ?? 1)) / 2 * timeline.totalFrames)
      player.seekTo(posterFrame)
      currentFrameRef.current = posterFrame
      setCurrentFrame(posterFrame)
      posterChosen.current = true
    } else {
      const clampedFrame = Math.min(currentFrameRef.current, timeline.totalFrames - 1)
      if (clampedFrame !== currentFrameRef.current) {
        player.seekTo(clampedFrame)
        currentFrameRef.current = clampedFrame
        setCurrentFrame(clampedFrame)
      }
    }

    const updateFrame = (event: { detail: { frame: number } }): void => {
      currentFrameRef.current = event.detail.frame
      setCurrentFrame(event.detail.frame)
    }
    const onPlay = (): void => {
      setPlaying(true)
    }
    const onPause = (): void => {
      setPlaying(false)
    }

    player.addEventListener('frameupdate', updateFrame)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onPause)
    return () => {
      player.removeEventListener('frameupdate', updateFrame)
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onPause)
    }
  }, [timeline])

  return (
    <div className="player-wrap">
      {stale && <div className="pane-stale" role="status">preview updating…</div>}
      <Player
        ref={playerRef}
        component={Film}
        inputProps={{ timeline }}
        durationInFrames={timeline.totalFrames}
        fps={timeline.fps}
        compositionWidth={timeline.width}
        compositionHeight={timeline.height}
        style={{ width: '100%', maxHeight: 'calc(100dvh - 160px)', aspectRatio: `${timeline.width} / ${timeline.height}` }}
        controls={false}
        loop
        acknowledgeRemotionLicense
      />
      <div className="preview-transport">
        <button
          className="transport-button"
          type="button"
          aria-label={playing ? 'pause preview' : 'play preview'}
          onClick={() => {
            const player = playerRef.current
            if (player === null) return
            if (player.isPlaying()) player.pause()
            else player.play()
          }}
        >
          {playing ? 'pause' : 'play'}
        </button>
        <span className="frame-readout">frame {currentFrame + 1} / {timeline.totalFrames}</span>
      </div>
      <FormationRibbon timeline={timeline} playerRef={playerRef} currentFrame={currentFrame} />
    </div>
  )
}

const FORMATION_LABELS: Record<string, string> = {
  marks: 'marks',
  spine: 'spine',
  totem: 'totem',
  columns: 'columns',
  ring: 'ring',
  quad: 'quad'
}

const FormationRibbon: React.FC<{ timeline: Timeline; playerRef: React.RefObject<PlayerRef | null>; currentFrame: number }> = ({ timeline, playerRef, currentFrame }) => {
  const total = timeline.totalFrames
  const formations = timeline.style === 'glyph' ? timeline.formations : []
  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const progress = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
    playerRef.current?.seekTo(Math.min(total - 1, Math.floor(progress * total)))
  }
  const p = currentFrame / total
  const active = formations.find((formation) => p >= formation.startPhase && p <= formation.endPhase)
  const activeLabel = active ? FORMATION_LABELS[active.id] ?? active.id : 'film'
  return (
    <div
      className="act-ribbon"
      role="slider"
      tabIndex={0}
      aria-label="film frame"
      aria-valuemin={0}
      aria-valuemax={total - 1}
      aria-valuenow={currentFrame}
      aria-valuetext={`${activeLabel}, frame ${currentFrame + 1} of ${total}`}
      aria-orientation="horizontal"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        seekFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) seekFromPointer(event)
      }}
      onKeyDown={(event) => {
        const steps: Partial<Record<React.KeyboardEvent['key'], number>> = {
          ArrowLeft: -1,
          ArrowDown: -1,
          ArrowRight: 1,
          ArrowUp: 1,
          PageDown: -timeline.fps,
          PageUp: timeline.fps
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          playerRef.current?.seekTo(event.key === 'Home' ? 0 : total - 1)
          return
        }
        const step = steps[event.key]
        if (step === undefined) return
        event.preventDefault()
        playerRef.current?.seekTo(Math.max(0, Math.min(total - 1, currentFrame + step)))
      }}
    >
      {formations.map((formation, i) => (
        <span
          key={formation.beat}
          className={`act-block${active?.beat === formation.beat ? ' act-block-active' : ''}`}
          style={{
            width: `${(formation.endPhase - formation.startPhase) * 100}%`,
            background: i % 2 === 0 ? '#2e2e2e' : '#383838',
            border: 'none',
            borderRadius: 0,
            padding: 0,
            cursor: 'ew-resize'
          }}
          title={`${formation.id}: ${(formation.startPhase * 100).toFixed(0)}%–${(formation.endPhase * 100).toFixed(0)}% of the loop`}
        >
          <span className="act-label">{FORMATION_LABELS[formation.id] ?? formation.id}</span>
        </span>
      ))}
      <span className="ribbon-playhead" aria-hidden="true" style={{ left: `${((currentFrame + 0.5) / total) * 100}%` }} />
    </div>
  )
}

const KnobPanel: React.FC<{
  knobs: StudioKnobs
  onKnobs: (patch: Partial<StudioKnobs>) => void
  seed: number | null
  onSeed: (seed: number | null) => void
  duration: 'auto' | number
  onDuration: (duration: 'auto' | number) => void
  disabled: boolean
}> = ({ knobs, onKnobs, seed, onSeed, duration, onDuration, disabled }) => {
  const rangeKnobs: Array<{ key: keyof typeof KNOB_RANGES; label: string }> = [
    { key: 'density', label: 'density' },
    { key: 'texts', label: 'texts' }
  ]
  return (
    <section className="panel">
      <h2>film</h2>
      <div className="knob-grid">
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
                  disabled={disabled}
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
              disabled={disabled}
              onChange={(e) => {
                const raw = e.target.value
                onSeed(raw === '' ? null : Math.floor(Number(raw)))
              }}
            />
            <button
              className="ghost"
              aria-label="randomize seed"
              title="randomize seed"
              disabled={disabled}
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
              disabled={disabled}
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
              disabled={disabled}
              onChange={(e) => {
                const raw = e.target.value
                onDuration(raw === '' ? 'auto' : Number(raw))
              }}
            />
            <button className="ghost" disabled={disabled} onClick={() => {
              onDuration('auto')
            }}>auto</button>
          </div>
        </div>
      </div>
    </section>
  )
}

const ExportControl: React.FC<{ state: ExportState | null; onExport: () => Promise<void>; onCancel: () => void; disabled: boolean }> = ({ state, onExport, onCancel, disabled }) => {
  return (
    <div className="export-control">
      {state === null && (
        <button className="primary" disabled={disabled} onClick={() => {
          void onExport()
        }}>export film</button>
      )}
      {state?.status === 'submitting' && (
        <>
          <span className="export-status" role="status">submitting…</span>
          <button className="ghost" onClick={onCancel}>cancel</button>
        </>
      )}
      {state?.status === 'rendering' && (
        <>
          <span className="export-status" role="status">rendering {state.job.progress > 0 ? `${state.job.progress}%` : '…'}</span>
          <button className="ghost" onClick={onCancel}>cancel</button>
        </>
      )}
      {state?.status === 'failed' && (
        <>
          <span className="export-error" role="alert">failed: {state.error}</span>
          <button className="ghost" disabled={disabled} onClick={() => {
            void onExport()
          }}>again</button>
        </>
      )}
      {state?.status === 'cancelled' && (
        <>
          <span className="export-status" role="status">cancelled</span>
          <button className="ghost" disabled={disabled} onClick={() => {
            void onExport()
          }}>again</button>
        </>
      )}
      {state?.status === 'completed' && (
        <span className="export-status" role="status">completed</span>
      )}
      {state?.status === 'completed' && (
        <>
          <span className={`gate-chip ${state.job.gatePassed === true ? 'gate-ok' : 'gate-warn'}`} title={state.job.gateDetail ?? 'advisory metrics unavailable'}>
            {state.job.gatePassed === null ? 'gate unavailable' : `gate ${state.job.gatePassed ? 'pass' : 'advisory'}`}
          </span>
          <a className="button-link" href={downloadUrl(state.job.jobId)}>download</a>
          <button className="ghost" disabled={disabled} onClick={() => {
            void onExport()
          }}>again</button>
        </>
      )}
    </div>
  )
}
