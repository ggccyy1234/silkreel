import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import type { FilmConfig } from '@silk-reel/choreo'
import { DEMO_BOARDS, isDemoBoardId, boardFromJson } from './boards.js'
import { RenderQueue } from './queue.js'
import type { RenderQueuePort, RenderSubmission } from './queue.js'
import { runGate } from './gate.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const allowedVideoRoots = [path.join(repoRoot, 'exports'), path.join(repoRoot, 'fixtures')]

function isInsideRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export interface BuildAppOptions {
  queue?: RenderQueuePort
  runGate?: typeof runGate
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 })
  const gateRunner = options.runGate ?? runGate
  const queue = options.queue ?? new RenderQueue({ runGate: gateRunner })

  app.get('/health', () => Promise.resolve({ ok: true as const, service: 'render-api' }))

  app.get('/demos', () => Promise.resolve({ demos: DEMO_BOARDS }))

  app.post('/render', async (request, reply) => {
    const parsed = parseRenderRequest(request.body)
    if (!parsed.ok) {
      if ('known' in parsed) return await reply.code(400).send({ error: parsed.error, known: parsed.known })
      return await reply.code(400).send({ error: parsed.error })
    }
    const job = queue.submit(parsed.input)
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
    if (!existsSync(job.downloadPath)) {
      return await reply.code(410).send({ error: 'render artifact missing' })
    }
    reply.header('content-type', 'video/mp4')
    reply.header('content-disposition', `attachment; filename="silk-reel-${id}.mp4"`)
    return await reply.send(createReadStream(job.downloadPath))
  })

  app.post('/gate', async (request, reply) => {
    const body = (request.body ?? {}) as { videoPath?: string }
    if (typeof body.videoPath !== 'string' || body.videoPath.length === 0) {
      return await reply.code(400).send({ error: 'videoPath required' })
    }
    const resolved = path.isAbsolute(body.videoPath) ? path.resolve(body.videoPath) : path.resolve(repoRoot, body.videoPath)
    if (!allowedVideoRoots.some((root) => isInsideRoot(resolved, root))) {
      return await reply.code(400).send({ error: 'videoPath must live under exports/ or fixtures/' })
    }
    if (!existsSync(resolved)) {
      return await reply.code(404).send({ error: `no file at ${body.videoPath}` })
    }
    const report = await gateRunner(resolved, {
      width: 1080,
      height: 1350,
      fps: 15,
      totalFrames: 167
    })
    return await reply.send(report)
  })

  app.get('/queue', () => {
    const jobs = [...queue.snapshot().values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return Promise.resolve({ jobs })
  })

  return app
}

type RenderRequestResult =
  | { ok: true; input: RenderSubmission }
  | { ok: false; error: string }
  | { ok: false; error: string; known: typeof DEMO_BOARDS }

type FilmConfigResult =
  | { ok: true; config: Partial<FilmConfig> | undefined }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseFilmConfig(value: unknown): FilmConfigResult {
  if (value === undefined) return { ok: true, config: undefined }
  if (!isRecord(value)) return { ok: false, error: 'filmConfig must be an object' }
  if ('actOrder' in value && (!Array.isArray(value.actOrder) || !value.actOrder.every((item) => typeof item === 'string'))) {
    return { ok: false, error: 'filmConfig.actOrder must be an array of strings' }
  }
  if ('knobs' in value && !isRecord(value.knobs)) {
    return { ok: false, error: 'filmConfig.knobs must be an object' }
  }
  if ('output' in value && !isRecord(value.output)) {
    return { ok: false, error: 'filmConfig.output must be an object' }
  }
  if ('seed' in value && value.seed !== null && typeof value.seed !== 'number') {
    return { ok: false, error: 'filmConfig.seed must be a number or null' }
  }
  if ('duration' in value && value.duration !== 'auto' && typeof value.duration !== 'number') {
    return { ok: false, error: "filmConfig.duration must be 'auto' or a number" }
  }
  const output = value.output
  if (isRecord(output)) {
    if ('width' in output && typeof output.width !== 'number') return { ok: false, error: 'filmConfig.output.width must be a number' }
    if ('height' in output && typeof output.height !== 'number') return { ok: false, error: 'filmConfig.output.height must be a number' }
    if ('fps' in output && typeof output.fps !== 'number') return { ok: false, error: 'filmConfig.output.fps must be a number' }
  }
  return { ok: true, config: value }
}

function parseRenderRequest(body: unknown): RenderRequestResult {
  if (!isRecord(body)) return { ok: false, error: 'request body must be an object' }
  const hasDemo = Object.hasOwn(body, 'demoId')
  const hasBoard = Object.hasOwn(body, 'boardJson')
  if (hasDemo === hasBoard) return { ok: false, error: 'provide exactly one of demoId or boardJson' }

  const parsedConfig = parseFilmConfig(body.filmConfig)
  if (!parsedConfig.ok) return parsedConfig
  const config = parsedConfig.config

  if (hasDemo) {
    const demoId = body.demoId
    if (typeof demoId !== 'string' || demoId.length === 0) {
      return { ok: false, error: 'demoId must be a non-empty string' }
    }
    if (!isDemoBoardId(demoId)) return { ok: false, error: `unknown demoId ${demoId}`, known: DEMO_BOARDS }
    return { ok: true, input: { demoId, ...(config !== undefined ? { config } : {}) } }
  }

  if (!isRecord(body.boardJson)) return { ok: false, error: 'boardJson must be an object' }
  try {
    boardFromJson(body.boardJson)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid boardJson' }
  }
  return { ok: true, input: { boardJson: body.boardJson, ...(config !== undefined ? { config } : {}) } }
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
