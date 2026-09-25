import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { buildApp } from './server.js'
import type { GateExpectations, GateReport } from './gate.js'
import type { RenderJob, RenderQueuePort, RenderSubmission } from './queue.js'

interface JobResponse {
  jobId: string
  status: string
}

interface DemosResponse {
  demos: string[]
}

interface JobStatusResponse {
  status: string
}

const testExports = path.resolve(import.meta.dirname, '../../../exports/render-api-tests')

function completedJob(id: string, downloadPath: string): RenderJob {
  const now = new Date().toISOString()
  return {
    id,
    status: 'done',
    progress: 100,
    createdAt: now,
    startedAt: now,
    finishedAt: now,
    downloadPath,
    gate: { status: 'unavailable', error: 'metrics unavailable' },
    metricsError: 'metrics unavailable'
  }
}

class StubQueue implements RenderQueuePort {
  readonly submissions: RenderSubmission[] = []
  private readonly jobs = new Map<string, RenderJob>()

  prepare(): Promise<void> {
    return Promise.resolve()
  }

  submit(input: RenderSubmission): RenderJob {
    this.submissions.push(input)
    const job: RenderJob = {
      id: `job-${this.submissions.length}`,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString()
    }
    this.jobs.set(job.id, job)
    return { ...job }
  }

  cancel(id: string): RenderJob | undefined {
    const job = this.jobs.get(id)
    if (job === undefined || job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
      return job ? { ...job } : undefined
    }
    const cancelled: RenderJob = { ...job, status: 'cancelled', finishedAt: new Date().toISOString() }
    this.jobs.set(id, cancelled)
    return { ...cancelled }
  }

  get(id: string): RenderJob | undefined {
    const job = this.jobs.get(id)
    return job ? { ...job } : undefined
  }

  snapshot(): Map<string, RenderJob> {
    return new Map([...this.jobs.entries()].map(([id, job]) => [id, { ...job }]))
  }

  add(job: RenderJob): void {
    this.jobs.set(job.id, job)
  }
}

async function withApp(queue: RenderQueuePort, run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app: FastifyInstance = buildApp({ queue })
  try {
    await run(app)
  } finally {
    await app.close()
  }
}

describe('render-api contract', () => {
  it('reports health and demo list', async () => {
    await withApp(new StubQueue(), async (app) => {
      const health = await app.inject({ method: 'GET', url: '/health' })
      expect(health.statusCode).toBe(200)
      expect(health.json()).toMatchObject({ ok: true, service: 'render-api' })
      const demos = await app.inject({ method: 'GET', url: '/demos' })
      const demosBody = demos.json<Partial<DemosResponse>>()
      expect(demosBody.demos).toContain('ecc83-pp')
    })
  })

  it('rejects malformed render bodies before queue admission', async () => {
    const queue = new StubQueue()
    await withApp(queue, async (app) => {
      for (const payload of [
        null,
        [],
        { demoId: 42 },
        { demoId: '' },
        { boardJson: null },
        { boardJson: [] },
        { boardJson: {} },
        { demoId: 'ecc83-pp', filmConfig: [] },
        { demoId: 'ecc83-pp', filmConfig: { output: null } },
        { demoId: 'ecc83-pp', filmConfig: { mystery: true } },
        { demoId: 'ecc83-pp', filmConfig: { knobs: { palette: 'rainbow' } } },
        { demoId: 'ecc83-pp', filmConfig: { output: { width: -1 } } },
        { demoId: 'ecc83-pp', filmConfig: { cast: { hero: ['U1'] } } },
        { demoId: 'ecc83-pp', filmConfig: { cast: { preferRefs: 'U1' } } }
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/render',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(payload)
        })
        expect(response.statusCode).toBe(400)
      }
      const neither = await app.inject({ method: 'POST', url: '/render', payload: {} })
      expect(neither.statusCode).toBe(400)
      const both = await app.inject({
        method: 'POST',
        url: '/render',
        payload: { demoId: 'ecc83-pp', boardJson: {} }
      })
      expect(both.statusCode).toBe(400)
      const unknown = await app.inject({ method: 'POST', url: '/render', payload: { demoId: 'nope' } })
      expect(unknown.statusCode).toBe(400)
      expect(queue.submissions).toHaveLength(0)
    })
  })

  it('normalizes partial output metadata at the request boundary', async () => {
    const queue = new StubQueue()
    await withApp(queue, async (app) => {
      const response = await app.inject({
        method: 'POST',
        url: '/render',
        payload: { demoId: 'ecc83-pp', filmConfig: { output: { fps: 24 } } }
      })
      expect(response.statusCode).toBe(202)
      expect(queue.submissions[0]?.config?.output).toEqual({ width: 1080, height: 1350, fps: 24 })
    })
  })

  it('accepts a valid submission and exposes job lifecycle endpoints', async () => {
    const queue = new StubQueue()
    await withApp(queue, async (app) => {
      const submitted = await app.inject({
        method: 'POST',
        url: '/render',
        payload: { demoId: 'ecc83-pp', filmConfig: { knobs: { density: 1.2 } } }
      })
      expect(submitted.statusCode).toBe(202)
      const submittedBody: JobResponse = submitted.json()
      expect(submittedBody.status).toBe('pending')
      expect(queue.submissions).toHaveLength(1)
      const jobId = submittedBody.jobId
      const polled = await app.inject({ method: 'GET', url: `/job/${jobId}` })
      expect(polled.statusCode).toBe(200)
      expect(polled.json<JobStatusResponse>().status).toBe('pending')
      const missing = await app.inject({ method: 'GET', url: '/job/does-not-exist' })
      expect(missing.statusCode).toBe(404)
    })
  })

  it('cancels queued jobs and rejects cancellation after completion', async () => {
    const queue = new StubQueue()
    await withApp(queue, async (app) => {
      const submitted = await app.inject({ method: 'POST', url: '/render', payload: { demoId: 'ecc83-pp' } })
      const jobId = submitted.json<JobResponse>().jobId
      const cancelled = await app.inject({ method: 'POST', url: `/job/${jobId}/cancel` })
      expect(cancelled.statusCode).toBe(200)
      expect(cancelled.json<JobStatusResponse>().status).toBe('cancelled')
      const repeated = await app.inject({ method: 'POST', url: `/job/${jobId}/cancel` })
      expect(repeated.statusCode).toBe(200)
      expect(repeated.json<JobStatusResponse>().status).toBe('cancelled')
      const missing = await app.inject({ method: 'POST', url: '/job/does-not-exist/cancel' })
      expect(missing.statusCode).toBe(404)

      queue.add(completedJob('done-job', path.join(testExports, 'done-job.mp4')))
      const completed = await app.inject({ method: 'POST', url: '/job/done-job/cancel' })
      expect(completed.statusCode).toBe(409)
      expect(completed.json<{ job: RenderJob }>().job.status).toBe('done')
    })
  })

  it('download refuses jobs that are not done', async () => {
    const queue = new StubQueue()
    await withApp(queue, async (app) => {
      const submitted = await app.inject({
        method: 'POST',
        url: '/render',
        payload: { demoId: 'ecc83-pp' }
      })
      const jobId = submitted.json<JobResponse>().jobId
      const early = await app.inject({ method: 'GET', url: `/download/${jobId}` })
      expect([409, 410]).toContain(early.statusCode)
      const unknown = await app.inject({ method: 'GET', url: '/download/does-not-exist' })
      expect(unknown.statusCode).toBe(404)
    })
  })

  it('downloads completed renders when the advisory is unavailable', async () => {
    await mkdir(testExports, { recursive: true })
    const downloadPath = path.join(testExports, 'done-job.mp4')
    await writeFile(downloadPath, 'tiny video')
    const queue = new StubQueue()
    queue.add(completedJob('done-job', downloadPath))
    try {
      await withApp(queue, async (app) => {
        const response = await app.inject({ method: 'GET', url: '/download/done-job' })
        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toBe('video/mp4')
        expect(response.body).toBe('tiny video')
      })
    } finally {
      await rm(testExports, { recursive: true, force: true })
    }
  })

  it('refuses completed-job paths outside exports and symlinks that escape it', async () => {
    await mkdir(testExports, { recursive: true })
    const escapedLink = path.join(testExports, 'escaped.mp4')
    await symlink('/etc/passwd', escapedLink)
    const queue = new StubQueue()
    queue.add(completedJob('outside', '/etc/passwd'))
    queue.add(completedJob('symlink', escapedLink))
    try {
      await withApp(queue, async (app) => {
        const outside = await app.inject({ method: 'GET', url: '/download/outside' })
        const symlinked = await app.inject({ method: 'GET', url: '/download/symlink' })
        expect(outside.statusCode).toBe(410)
        expect(symlinked.statusCode).toBe(410)
      })
    } finally {
      await rm(testExports, { recursive: true, force: true })
    }
  })

  it('gate endpoint validates path scope', async () => {
    await withApp(new StubQueue(), async (app) => {
      const missing = await app.inject({
        method: 'POST',
        url: '/gate',
        payload: { videoPath: '/etc/passwd' }
      })
      expect(missing.statusCode).toBe(400)
      const absent = await app.inject({
        method: 'POST',
        url: '/gate',
        payload: { videoPath: 'fixtures/nope.mp4' }
      })
      expect(absent.statusCode).toBe(404)
    })
  })

  it('uses an injected gate runner for the fixed canonical expectation', async () => {
    const calls: Array<{ videoPath: string; totalFrames: number }> = []
    const runGate = (videoPath: string, expectations: GateExpectations): Promise<GateReport> => {
      calls.push({ videoPath, totalFrames: expectations.totalFrames })
      return Promise.resolve({
        file: videoPath,
        passed: true,
        facts: {
          width: expectations.width,
          height: expectations.height,
          fps: expectations.fps,
          durationSeconds: expectations.totalFrames / expectations.fps,
          frameCount: expectations.totalFrames,
          codec: 'h264',
          pixFmt: 'yuv420p',
          audioStreamCount: 0
        },
        rules: []
      })
    }
    const app = buildApp({ queue: new StubQueue(), runGate })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/gate',
        payload: { videoPath: 'fixtures/boards/ecc83-pp.kicad_pcb' }
      })
      expect(response.statusCode).toBe(200)
      expect(response.json<GateReport>().passed).toBe(true)
    } finally {
      await app.close()
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]?.totalFrames).toBe(167)
  })
})
