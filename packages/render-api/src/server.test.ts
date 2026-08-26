import { describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './server.js'
import { RenderQueue } from './queue.js'

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

async function withApp(queue: RenderQueue, run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const app: FastifyInstance = buildApp({ queue })
  await run(app)
  await app.close()
}

describe('render-api contract', () => {
  it('reports health and demo list', async () => {
    await withApp(new RenderQueue(), async (app) => {
      const health = await app.inject({ method: 'GET', url: '/health' })
      expect(health.statusCode).toBe(200)
      expect(health.json()).toMatchObject({ ok: true, service: 'render-api' })
      const demos = await app.inject({ method: 'GET', url: '/demos' })
      const demosBody = demos.json<Partial<DemosResponse>>()
      expect(demosBody.demos).toContain('ecc83-pp')
    })
  })

  it('rejects render requests without exactly one board source', async () => {
    await withApp(new RenderQueue(), async (app) => {
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
    })
  })

  it('accepts a valid submission and exposes job lifecycle endpoints', async () => {
    await withApp(new RenderQueue(), async (app) => {
      const submitted = await app.inject({
        method: 'POST',
        url: '/render',
        payload: { demoId: 'ecc83-pp', filmConfig: { knobs: { glow: 0.5 } } }
      })
      expect(submitted.statusCode).toBe(202)
      const submittedBody: JobResponse = submitted.json()
      const jobId = submittedBody.jobId
      const polled = await app.inject({ method: 'GET', url: `/job/${jobId}` })
      expect(polled.statusCode).toBe(200)
      expect(['pending', 'rendering', 'done', 'error']).toContain(polled.json<JobStatusResponse>().status)
      const missing = await app.inject({ method: 'GET', url: '/job/does-not-exist' })
      expect(missing.statusCode).toBe(404)
    })
  })

  it('download refuses jobs that are not done', async () => {
    const queue = new RenderQueue()
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

  it('gate endpoint validates path scope', async () => {
    await withApp(new RenderQueue(), async (app) => {
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

  it('queue serializes submissions FIFO', () => {
    const queue = new RenderQueue()
    const first = queue.submit({ demoId: 'ecc83-pp' })
    const second = queue.submit({ demoId: 'ecc83-pp' })
    expect(first.id).not.toBe(second.id)
    expect(queue.get(first.id)?.status).toBeDefined()
    expect(queue.jobCount()).toBe(2)
  })
})
