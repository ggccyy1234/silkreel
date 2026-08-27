import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { FilmConfig } from '@silk-reel/choreo'
import type { GateReport } from '@silk-reel/metrics'
import { renderFilm } from './render-film.js'
import { compileFilm, loadDemoBoard, boardFromJson, defaultFilmConfig } from './boards.js'
import type { DemoBoardId } from './boards.js'
import { runGate } from './gate.js'

const renderEntryPoint = new URL('../../render/src/remotion-entry.tsx', import.meta.url).pathname
const exportsRoot = path.resolve(import.meta.dirname, '../../../exports')

export type GateAdvisory =
  | { status: 'passed'; report: GateReport }
  | { status: 'failed'; report: GateReport }
  | { status: 'unavailable'; error: string }

interface JobBase {
  id: string
  progress: number
  createdAt: string
}

type PendingJob = JobBase & { status: 'pending' }
type RenderingJob = JobBase & { status: 'rendering'; startedAt: string }
type DoneJobBase = JobBase & {
  status: 'done'
  startedAt: string
  finishedAt: string
  downloadPath: string
}
type DoneJob = DoneJobBase &
  (
    | { gate: Extract<GateAdvisory, { status: 'passed' | 'failed' }>; metricsReport: GateReport; metricsError?: never }
    | { gate: Extract<GateAdvisory, { status: 'unavailable' }>; metricsError: string; metricsReport?: never }
  )
type ErrorJob = JobBase & {
  status: 'error'
  startedAt: string
  finishedAt: string
  error: string
}

export type RenderJob = PendingJob | RenderingJob | DoneJob | ErrorJob
export type JobStatus = RenderJob['status']

type SubmissionOptions = { config?: Partial<FilmConfig> }

export type RenderSubmission =
  | (SubmissionOptions & { demoId: DemoBoardId; boardJson?: never })
  | (SubmissionOptions & { boardJson: Record<string, unknown>; demoId?: never })

export interface RenderQueuePort {
  submit(input: RenderSubmission): RenderJob
  get(id: string): RenderJob | undefined
  snapshot(): Map<string, RenderJob>
}

export type BundleRenderer = (entryPoint: string) => Promise<string>

export interface RenderQueueOptions {
  renderFilm?: typeof renderFilm
  runGate?: typeof runGate
  bundle?: BundleRenderer
  exportsRoot?: string
}

type QueueSource =
  | { kind: 'demo'; demoId: DemoBoardId }
  | { kind: 'json'; boardJson: Record<string, unknown> }

interface QueueEntry {
  job: PendingJob
  source: QueueSource
  config: FilmConfig
}

export class RenderQueue implements RenderQueuePort {
  private readonly jobs = new Map<string, RenderJob>()
  private readonly pending: QueueEntry[] = []
  private readonly renderFilm: typeof renderFilm
  private readonly runGate: typeof runGate
  private readonly bundle: BundleRenderer
  private readonly exportsRoot: string
  private draining = false
  private drainPromise: Promise<void> | undefined
  private bundleLocation: string | undefined

  constructor(options: RenderQueueOptions = {}) {
    this.renderFilm = options.renderFilm ?? renderFilm
    this.runGate = options.runGate ?? runGate
    this.bundle = options.bundle ?? bundleEntryPoint
    this.exportsRoot = options.exportsRoot ?? exportsRoot
  }

  submit(input: RenderSubmission): RenderJob {
    const job: PendingJob = {
      id: randomUUID(),
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString()
    }
    const entry: QueueEntry = {
      job,
      source: 'demoId' in input ? { kind: 'demo', demoId: input.demoId } : { kind: 'json', boardJson: input.boardJson },
      config: mergeConfig(input.config)
    }
    this.jobs.set(job.id, job)
    this.pending.push(entry)
    this.startDrain()
    return { ...job }
  }

  get(id: string): RenderJob | undefined {
    const job = this.jobs.get(id)
    return job ? { ...job } : undefined
  }

  jobCount(): number {
    return this.jobs.size
  }

  snapshot(): Map<string, RenderJob> {
    return new Map([...this.jobs.entries()].map(([id, job]) => [id, { ...job }]))
  }

  waitForIdle(): Promise<void> {
    return this.drainPromise ?? Promise.resolve()
  }

  private startDrain(): void {
    if (this.draining) return
    this.drainPromise = this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.pending.length > 0) {
        const entry = this.pending.shift()
        if (!entry) break
        await this.run(entry)
      }
    } finally {
      this.draining = false
      this.drainPromise = undefined
    }
  }

  private async ensureBundle(): Promise<string> {
    if (this.bundleLocation !== undefined) return this.bundleLocation
    const bundleLocation = await this.bundle(renderEntryPoint)
    this.bundleLocation = bundleLocation
    return bundleLocation
  }

  private start(entry: QueueEntry): RenderingJob {
    const job: RenderingJob = {
      ...entry.job,
      status: 'rendering',
      startedAt: new Date().toISOString()
    }
    this.jobs.set(job.id, job)
    return job
  }

  private updateProgress(id: string, progress: number): void {
    const job = this.jobs.get(id)
    if (job?.status !== 'rendering') return
    this.jobs.set(id, { ...job, progress })
  }

  private async readGateAdvisory(outputLocation: string, config: FilmConfig, totalFrames: number): Promise<GateAdvisory> {
    try {
      const report = await this.runGate(outputLocation, {
        width: config.output.width,
        height: config.output.height,
        fps: config.output.fps,
        totalFrames
      })
      return report.passed ? { status: 'passed', report } : { status: 'failed', report }
    } catch (err) {
      return { status: 'unavailable', error: errorMessage(err) }
    }
  }

  private async run(entry: QueueEntry): Promise<void> {
    const rendering = this.start(entry)
    let progress = rendering.progress
    try {
      const board = entry.source.kind === 'demo' ? await loadDemoBoard(entry.source.demoId) : boardFromJson(entry.source.boardJson)
      const { inputProps } = compileFilm(board, entry.config)
      const outputLocation = path.join(this.exportsRoot, `${rendering.id}.mp4`)
      const bundleLocation = await this.ensureBundle()
      await mkdir(this.exportsRoot, { recursive: true })
      await this.renderFilm({
        entryPoint: renderEntryPoint,
        bundleLocationOverride: bundleLocation,
        inputProps,
        outputLocation,
        onProgress: (pct) => {
          progress = pct
          this.updateProgress(rendering.id, pct)
        }
      })
      const gate = await this.readGateAdvisory(outputLocation, entry.config, inputProps.timeline.totalFrames)
      if (gate.status === 'unavailable') {
        const done: DoneJob = {
          ...rendering,
          status: 'done',
          progress: 100,
          finishedAt: new Date().toISOString(),
          downloadPath: outputLocation,
          gate,
          metricsError: gate.error
        }
        this.jobs.set(done.id, done)
      } else {
        const done: DoneJob = {
          ...rendering,
          status: 'done',
          progress: 100,
          finishedAt: new Date().toISOString(),
          downloadPath: outputLocation,
          gate,
          metricsReport: gate.report
        }
        this.jobs.set(done.id, done)
      }
    } catch (err) {
      const failed: ErrorJob = {
        ...rendering,
        status: 'error',
        progress,
        finishedAt: new Date().toISOString(),
        error: errorMessage(err)
      }
      this.jobs.set(failed.id, failed)
    }
  }
}

async function bundleEntryPoint(entryPoint: string): Promise<string> {
  const { bundle } = await import('@remotion/bundler')
  return bundle({ entryPoint, onProgress: () => undefined })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function mergeConfig(partial: Partial<FilmConfig> | undefined): FilmConfig {
  const base = defaultFilmConfig()
  if (!partial) return base
  return {
    actOrder: partial.actOrder ?? base.actOrder,
    knobs: { ...base.knobs, ...partial.knobs },
    seed: partial.seed !== undefined ? partial.seed : base.seed,
    duration: partial.duration !== undefined ? partial.duration : base.duration,
    output: { ...base.output, ...partial.output }
  }
}
