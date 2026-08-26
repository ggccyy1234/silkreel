import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import type { FilmConfig } from '@silk-reel/choreo'
import { DEMO_BOARDS } from './boards.js'
import { RenderQueue } from './queue.js'
import { runGate } from './gate.js'

export interface BuildAppOptions {
  queue?: RenderQueue
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false })
  const queue = options.queue ?? new RenderQueue()

  app.get('/health', () => Promise.resolve({ ok: true as const, service: 'render-api' }))

  app.get('/demos', () => Promise.resolve({ demos: DEMO_BOARDS }))

  interface RenderBody {
    demoId?: string
    boardJson?: unknown
    filmConfig?: Partial<FilmConfig>
  }

  app.post('/render', async (request, reply) => {
    const body = (request.body ?? {}) as RenderBody
    const hasDemo = typeof body.demoId === 'string' && body.demoId.length > 0
    const hasBoard = body.boardJson !== undefined && body.boardJson !== null
    if (hasDemo === hasBoard) {
      return await reply.code(400).send({
        error: 'provide exactly one of demoId or boardJson'
      })
    }
    if (hasDemo && !DEMO_BOARDS.includes(body.demoId as never)) {
      return await reply.code(400).send({
        error: `unknown demoId ${String(body.demoId)}`,
        known: DEMO_BOARDS
      })
    }
    const job = queue.submit({
      ...(hasDemo ? { demoId: body.demoId as string } : {}),
      ...(hasBoard ? { boardJson: body.boardJson } : {}),
      ...(body.filmConfig !== undefined ? { config: body.filmConfig } : {})
    })
    return await reply.code(202).send({ jobId: job.id, status: job.status })
  })

  app.get('/job/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = queue.get(id)
    if (!job) return await reply.code(404).send({ error: `no job ${id}` })
    return await reply.send(job)
  })

  app.get('/download/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = queue.get(id)
    if (!job) return await reply.code(404).send({ error: `no job ${id}` })
    if (job.status !== 'done') {
      return await reply.code(409).send({ error: `job ${id} is ${job.status}, not done` })
    }
    const file = job.downloadPath
    if (!file || !existsSync(file)) {
      return await reply.code(410).send({ error: 'render artifact missing' })
    }
    reply.header('content-type', 'video/mp4')
    reply.header('content-disposition', `attachment; filename="silk-reel-${id}.mp4"`)
    return await reply.send(createReadStream(file))
  })

  app.post('/gate', async (request, reply) => {
    const body = (request.body ?? {}) as { videoPath?: string }
    if (typeof body.videoPath !== 'string' || body.videoPath.length === 0) {
      return await reply.code(400).send({ error: 'videoPath required' })
    }
    const resolved = path.resolve(body.videoPath)
    if (!resolved.startsWith(path.resolve('exports')) && !resolved.startsWith(path.resolve('fixtures'))) {
      return await reply.code(400).send({ error: 'videoPath must live under exports/ or fixtures/' })
    }
    if (!existsSync(resolved)) {
      return await reply.code(404).send({ error: `no file at ${body.videoPath}` })
    }
    const report = await runGate(resolved, {
      width: 1080,
      height: 1350,
      fps: 15,
      totalFrames: 191
    })
    return await reply.send(report)
  })

  app.get('/queue', () => {
    const jobs = [...queue.snapshot().values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return Promise.resolve({ jobs })
  })

  return app
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))
if (isMain) {
  const app: FastifyInstance = buildApp()
  const port = 3102
  app
    .listen({ port, host: '127.0.0.1' })
    .then(() => {
      console.log(`render-api listening on ${port}`)
    })
    .catch((err: unknown) => {
      console.error(err)
      process.exit(1)
    })
}
