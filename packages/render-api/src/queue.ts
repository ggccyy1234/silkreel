import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { FilmConfig } from '@silk-reel/choreo'
import type { GateReport } from '@silk-reel/metrics'
import { renderFilm } from './render-film.js'
import { compileFilm, loadDemoBoard, boardFromJson, defaultFilmConfig } from './boards.js'
import { runGate } from './gate.js'

export type JobStatus = 'pending' | 'rendering' | 'done' | 'error'

export interface RenderJob {
  id: string
  status: JobStatus
  progress: number
  createdAt: string
  startedAt?: string | undefined
  finishedAt?: string | undefined
  error?: string | undefined
  metricsReport?: GateReport | undefined
  metricsError?: string | undefined
  downloadPath?: string | undefined
}

interface QueueEntry {
  job: RenderJob
  boardJson?: unknown
  demoId?: string | undefined
  config: FilmConfig
}

const exportsRoot = path.resolve(import.meta.dirname, '../../../exports')

export class RenderQueue {
  private readonly jobs = new Map<string, RenderJob>()
  private readonly pending: QueueEntry[] = []
  private draining = false
  private bundleLocation: string | undefined

  submit(input: { demoId?: string; boardJson?: unknown; config?: Partial<FilmConfig> }): RenderJob {
    const config = mergeConfig(input.config)
    const entry: QueueEntry = {
      job: {
        id: randomUUID(),
        status: 'pending',
        progress: 0,
        createdAt: new Date().toISOString()
      },
      ...(input.boardJson !== undefined ? { boardJson: input.boardJson } : {}),
      ...(input.demoId !== undefined ? { demoId: input.demoId } : {}),
      config
    }
    this.jobs.set(entry.job.id, entry.job)
    this.pending.push(entry)
    void this.drain()
    return { ...entry.job }
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
    }
  }

  private async ensureBundle(): Promise<string> {
    if (!this.bundleLocation) {
      const { bundle } = await import('@remotion/bundler')
      this.bundleLocation = await bundle({
        entryPoint: new URL('../../render/src/remotion-entry.tsx', import.meta.url).pathname,
        onProgress: () => undefined
      })
    }
    return this.bundleLocation
  }

  private async run(entry: QueueEntry): Promise<void> {
    const job = entry.job
    job.status = 'rendering'
    job.startedAt = new Date().toISOString()
    try {
      const board =
        entry.demoId !== undefined ? await loadDemoBoard(entry.demoId) : boardFromJson(entry.boardJson)
      const { inputProps } = compileFilm(board, entry.config)
      const outputLocation = path.join(exportsRoot, `${job.id}.mp4`)
      const bundleLocation = await this.ensureBundle()
      await mkdir(exportsRoot, { recursive: true })
      await renderFilm({
        entryPoint: new URL('../../render/src/remotion-entry.tsx', import.meta.url).pathname,
        bundleLocationOverride: bundleLocation,
        inputProps,
        outputLocation,
        onProgress: (pct) => {
          job.progress = pct
        }
      })
      job.downloadPath = outputLocation
      job.progress = 100
      try {
        job.metricsReport = await runGate(outputLocation, {
          width: entry.config.output.width,
          height: entry.config.output.height,
          fps: entry.config.output.fps,
          totalFrames: inputProps.timeline.totalFrames
        })
      } catch (err) {
        job.metricsError = err instanceof Error ? err.message : String(err)
      }
      job.status = 'done'
    } catch (err) {
      job.status = 'error'
      job.error = err instanceof Error ? err.message : String(err)
    } finally {
      job.finishedAt = new Date().toISOString()
    }
  }
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
