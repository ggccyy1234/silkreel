import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import path from 'node:path'
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

class StubQueue implements RenderQueuePort {
  readonly submissions: RenderSubmission[] = []
  private readonly jobs = new Map<string, RenderJob>()

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
        { demoId: 'ecc83-pp', filmConfig: { output: null } }
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

  it('accepts a valid submission and exposes job lifecycle endpoints', async () => {
    const queue = new StubQueue()
    await withApp(queue, async (app) => {
      const submitted = await app.inject({
        method: 'POST',
        url: '/render',
        payload: { demoId: 'ecc83-pp', filmConfig: { knobs: { glow: 0.5 } } }
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
    const queue = new StubQueue()
    queue.add({
      id: 'done-job',
      status: 'done',
      progress: 100,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      downloadPath: path.resolve(import.meta.dirname, '../../../fixtures/canonical.mp4'),
      gate: { status: 'unavailable', error: 'metrics unavailable' },
      metricsError: 'metrics unavailable'
    })
    await withApp(queue, async (app) => {
      const response = await app.inject({ method: 'GET', url: '/download/done-job' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('video/mp4')
    })
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
          pixFmt: 'yuv420p'
        },
        rules: []
      })
    }
    const app = buildApp({ queue: new StubQueue(), runGate })
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/gate',
        payload: { videoPath: 'fixtures/canonical.mp4' }
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
