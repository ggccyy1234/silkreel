import path from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { ASPECT_SIZE } from '@silk-reel/choreo'
import type { FilmConfig, Timeline } from '@silk-reel/choreo'
import type { GateReport } from '@silk-reel/metrics'
import { FORMAT_EXT, RENDER_ENTRY, isAlphaFormat, renderFilm } from './render-film.js'
import type { OutputFormat } from './render-film.js'
import { compileFilm, loadDemoBoard, boardFromJson, defaultFilmConfig } from './boards.js'
import type { DemoBoardId } from './boards.js'
import { runGate } from '@silk-reel/metrics'
const exportsRoot = path.resolve(import.meta.dirname, '../../../exports')

export type GateAdvisory =
  | { status: 'passed'; report: GateReport }
  | { status: 'failed'; report: GateReport }
  | { status: 'unavailable'; error: string }

interface JobBase {
  id: string
  format: OutputFormat
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
type CancelledJob = JobBase & {
  status: 'cancelled'
  finishedAt: string
}

export type RenderJob = PendingJob | RenderingJob | DoneJob | ErrorJob | CancelledJob

type SubmissionOptions = { config?: Partial<FilmConfig>; format?: OutputFormat }

export type RenderSubmission =
  | (SubmissionOptions & { demoId: DemoBoardId; boardJson?: never })
  | (SubmissionOptions & { boardJson: Record<string, unknown>; demoId?: never })

export interface RenderQueuePort {
  prepare(): Promise<void>
  submit(input: RenderSubmission): RenderJob
  cancel(id: string): RenderJob | undefined
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

let machineTail: Promise<void> = Promise.resolve()

function enqueueMachine(task: () => Promise<void>): Promise<void> {
  const scheduled = machineTail.then(task)
  machineTail = scheduled.catch(() => undefined)
  return scheduled
}

export class RenderQueue implements RenderQueuePort {
  private readonly jobs = new Map<string, RenderJob>()
  private readonly renderFilm: typeof renderFilm
  private readonly runGate: typeof runGate
  private readonly bundle: BundleRenderer
  private readonly exportsRoot: string
  private idlePromise: Promise<void> = Promise.resolve()
  private bundleLocation: string | undefined
  private bundlePromise: Promise<string> | undefined

  constructor(options: RenderQueueOptions = {}) {
    this.renderFilm = options.renderFilm ?? renderFilm
    this.runGate = options.runGate ?? runGate
    this.bundle = options.bundle ?? bundleEntryPoint
    this.exportsRoot = options.exportsRoot ?? exportsRoot
  }

  async prepare(): Promise<void> {
    await this.ensureBundle()
  }

  submit(input: RenderSubmission): RenderJob {
    const job: PendingJob = {
      id: randomUUID(),
      format: input.format ?? 'mp4',
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString()
    }
    const entry: QueueEntry = {
      job,
      source: 'demoId' in input ? { kind: 'demo', demoId: input.demoId } : { kind: 'json', boardJson: input.boardJson },
      config: mergeConfig(input.config, 'demoId' in input ? input.demoId : undefined)
    }
    if (isAlphaFormat(job.format)) entry.config.transparent = true
    this.jobs.set(job.id, job)
    const scheduled = enqueueMachine(() => this.run(entry))
    const completion = scheduled.then(
      () => undefined,
      () => undefined
    )
    this.idlePromise = Promise.all([this.idlePromise, completion]).then(() => undefined)
    return { ...job }
  }

  get(id: string): RenderJob | undefined {
    const job = this.jobs.get(id)
    return job ? { ...job } : undefined
  }

  cancel(id: string): RenderJob | undefined {
    const job = this.jobs.get(id)
    if (job === undefined || job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
      return job ? { ...job } : undefined
    }
    const cancelled: CancelledJob = {
      ...job,
      status: 'cancelled',
      finishedAt: new Date().toISOString()
    }
    this.jobs.set(id, cancelled)
    return { ...cancelled }
  }

  snapshot(): Map<string, RenderJob> {
    return new Map([...this.jobs.entries()].map(([id, job]) => [id, { ...job }]))
  }

  waitForIdle(): Promise<void> {
    return this.idlePromise
  }

  private async ensureBundle(): Promise<string> {
    if (this.bundleLocation !== undefined) return this.bundleLocation
    if (this.bundlePromise === undefined) {
      this.bundlePromise = this.bundle(RENDER_ENTRY).then(
        (bundleLocation) => {
          this.bundleLocation = bundleLocation
          this.bundlePromise = undefined
          return bundleLocation
        },
        (err: unknown) => {
          this.bundlePromise = undefined
          throw err
        }
      )
    }
    return await this.bundlePromise
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

  private isCancelled(id: string): boolean {
    return this.jobs.get(id)?.status === 'cancelled'
  }

  private async discardOutput(outputLocation: string): Promise<void> {
    await rm(outputLocation, { force: true }).catch(() => undefined)
  }

  private async readGateAdvisory(outputLocation: string, config: FilmConfig, timeline: Timeline): Promise<GateAdvisory> {
    try {
      const report = await this.runGate(outputLocation, {
        width: config.output.width,
        height: config.output.height,
        fps: config.output.fps,
        totalFrames: timeline.totalFrames,
        style: timeline.style
      })
      return report.passed ? { status: 'passed', report } : { status: 'failed', report }
    } catch (err) {
      return { status: 'unavailable', error: errorMessage(err) }
    }
  }

  private async run(entry: QueueEntry): Promise<void> {
    if (this.isCancelled(entry.job.id)) return
    const rendering = this.start(entry)
    let progress = rendering.progress
    let outputLocation: string | undefined
    try {
      if (this.isCancelled(rendering.id)) return
      const board = entry.source.kind === 'demo' ? await loadDemoBoard(entry.source.demoId) : boardFromJson(entry.source.boardJson)
      if (this.isCancelled(rendering.id)) return
      const { inputProps } = compileFilm(board, entry.config)
      const { format } = rendering
      outputLocation = path.join(this.exportsRoot, `${rendering.id}.${FORMAT_EXT[format]}`)
      if (this.isCancelled(rendering.id)) return
      const bundleLocation = await this.ensureBundle()
      if (this.isCancelled(rendering.id)) return
      await mkdir(this.exportsRoot, { recursive: true })
      if (this.isCancelled(rendering.id)) return
      await this.renderFilm({
        bundleLocationOverride: bundleLocation,
        inputProps,
        outputLocation,
        format,
        onProgress: (pct) => {
          const nextProgress = nextJobProgress(progress, pct)
          if (nextProgress === undefined) return
          progress = nextProgress
          this.updateProgress(rendering.id, nextProgress)
        }
      })
      if (this.isCancelled(rendering.id)) {
        await this.discardOutput(outputLocation)
        return
      }
      const gate: GateAdvisory =
        format === 'mp4'
          ? await this.readGateAdvisory(outputLocation, entry.config, inputProps.timeline)
          : { status: 'unavailable', error: 'gate runs on mp4 only' }
      if (this.isCancelled(rendering.id)) {
        await this.discardOutput(outputLocation)
        return
      }
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
      if (this.isCancelled(rendering.id)) {
        if (outputLocation !== undefined) await this.discardOutput(outputLocation)
        return
      }
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

function nextJobProgress(current: number, reported: number): number | undefined {
  if (!Number.isFinite(reported)) return undefined
  return Math.max(current, Math.min(100, Math.max(0, reported)))
}

function mergeConfig(partial: Partial<FilmConfig> | undefined, demoId?: string): FilmConfig {
  const base = defaultFilmConfig(demoId)
  if (!partial) return base
  const config: FilmConfig = {
    ...base,
    knobs: { ...base.knobs, ...partial.knobs },
    seed: partial.seed !== undefined ? partial.seed : base.seed,
    duration: partial.duration !== undefined ? partial.duration : base.duration,
    output: { ...base.output, ...(partial.aspect !== undefined ? ASPECT_SIZE[partial.aspect] : {}), ...partial.output }
  }
  if (partial.style !== undefined) config.style = partial.style
  if (partial.aspect !== undefined) config.aspect = partial.aspect
  if (partial.palette !== undefined) config.palette = partial.palette
  if (partial.accent !== undefined) config.accent = partial.accent
  if (partial.title !== undefined) config.title = partial.title
  if (partial.transparent !== undefined) config.transparent = partial.transparent
  if (partial.cast !== undefined) config.cast = partial.cast
  return config
}
