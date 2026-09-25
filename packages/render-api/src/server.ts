import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FilmConfig, Knobs } from '@silk-reel/choreo'
import { DEMO_BOARDS, boardFromJson, defaultFilmConfig, isDemoBoardId } from './boards.js'
import { RenderQueue } from './queue.js'
import type { RenderQueuePort, RenderSubmission } from './queue.js'
import { runGate } from './gate.js'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const allowedVideoRoots = [path.join(repoRoot, 'exports'), path.join(repoRoot, 'fixtures')]
const FILM_CONFIG_KEYS = ['knobs', 'seed', 'duration', 'output', 'cast'] as const
const CAST_KEYS = ['preferRefs', 'preferTexts'] as const
const KNOB_KEYS = ['density', 'texts'] as const
const OUTPUT_KEYS = ['width', 'height', 'fps'] as const
const DEFAULT_OUTPUT = defaultFilmConfig().output

function isInsideRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function safeFilePath(target: string, roots: readonly string[]): Promise<string | undefined> {
  if (target.length === 0) return undefined
  const resolved = path.resolve(target)
  const lexicalRoot = roots.find((root) => isInsideRoot(resolved, root))
  if (lexicalRoot === undefined) return undefined
  try {
    const [realTarget, realRoot] = await Promise.all([realpath(resolved), realpath(lexicalRoot)])
    if (!isInsideRoot(realTarget, realRoot)) return undefined
    const details = await stat(realTarget)
    return details.isFile() ? realTarget : undefined
  } catch {
    return undefined
  }
}

function downloadFilename(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `silk-reel-${safeId || 'job'}.mp4`
}

export interface BuildAppOptions {
  queue?: RenderQueuePort
  runGate?: typeof runGate
}

type RenderApiError =
  | { error: string }
  | { error: string; known: typeof DEMO_BOARDS }

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 })
  const gateRunner = options.runGate ?? runGate
  const queue = options.queue ?? new RenderQueue({ runGate: gateRunner })

  app.addHook('onReady', async () => {
    await queue.prepare()
  })

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

  app.post('/job/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = queue.cancel(id)
    if (!job) return await reply.code(404).send({ error: `no job ${id}` })
    if (job.status === 'done' || job.status === 'error') {
      return await reply.code(409).send({ error: `job ${id} is ${job.status}, not cancellable`, job })
    }
    return await reply.send(job)
  })

  app.get('/download/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = queue.get(id)
    if (!job) return await reply.code(404).send({ error: `no job ${id}` })
    if (job.status !== 'done') {
      return await reply.code(409).send({ error: `job ${id} is ${job.status}, not done` })
    }
    const downloadPath = await safeFilePath(job.downloadPath, allowedVideoRoots)
    if (downloadPath === undefined) {
      return await reply.code(410).send({ error: 'render artifact missing' })
    }
    reply.header('content-type', 'video/mp4')
    reply.header('content-disposition', `attachment; filename="${downloadFilename(job.id)}"`)
    return await reply.send(createReadStream(downloadPath))
  })

  app.post('/gate', async (request, reply) => {
    const body = (request.body ?? {}) as { videoPath?: string }
    if (typeof body.videoPath !== 'string' || body.videoPath.length === 0) {
      return await reply.code(400).send({ error: 'videoPath required' })
    }
    const requestedPath = path.isAbsolute(body.videoPath) ? body.videoPath : path.resolve(repoRoot, body.videoPath)
    if (!allowedVideoRoots.some((root) => isInsideRoot(path.resolve(requestedPath), root))) {
      return await reply.code(400).send({ error: 'videoPath must live under exports/ or fixtures/' })
    }
    const videoPath = await safeFilePath(requestedPath, allowedVideoRoots)
    if (videoPath === undefined) {
      return await reply.code(404).send({ error: `no file at ${body.videoPath}` })
    }
    const report = await gateRunner(videoPath, {
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
  | ({ ok: false } & RenderApiError)

type FilmConfigResult =
  | { ok: true; config: Partial<FilmConfig> | undefined }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownField(value: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  return Object.keys(value).find((key) => !allowed.includes(key))
}

function parseKnobs(value: unknown): { ok: true; knobs: Knobs } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'filmConfig.knobs must be an object' }
  const unexpected = unknownField(value, KNOB_KEYS)
  if (unexpected !== undefined) return { ok: false, error: `filmConfig.knobs.${unexpected} is not supported` }
  for (const key of KNOB_KEYS) {
    if (Object.hasOwn(value, key) && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
      return { ok: false, error: `filmConfig.knobs.${key} must be a finite number` }
    }
  }
  return { ok: true, knobs: value }
}

function parseFilmConfig(value: unknown): FilmConfigResult {
  if (value === undefined) return { ok: true, config: undefined }
  if (!isRecord(value)) return { ok: false, error: 'filmConfig must be an object' }
  const unexpected = unknownField(value, FILM_CONFIG_KEYS)
  if (unexpected !== undefined) return { ok: false, error: `filmConfig.${unexpected} is not supported` }

  const config: Partial<FilmConfig> = {}
  if (Object.hasOwn(value, 'knobs')) {
    const parsed = parseKnobs(value.knobs)
    if (!parsed.ok) return parsed
    config.knobs = parsed.knobs
  }
  if (Object.hasOwn(value, 'seed')) {
    if (value.seed === null) {
      config.seed = null
    } else {
      if (typeof value.seed !== 'number' || !Number.isFinite(value.seed)) return { ok: false, error: 'filmConfig.seed must be a finite number or null' }
      config.seed = value.seed
    }
  }
  if (Object.hasOwn(value, 'duration')) {
    if (value.duration === 'auto') {
      config.duration = 'auto'
    } else {
      if (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0) return { ok: false, error: "filmConfig.duration must be 'auto' or a positive finite number" }
      config.duration = value.duration
    }
  }
  if (Object.hasOwn(value, 'output')) {
    if (!isRecord(value.output)) return { ok: false, error: 'filmConfig.output must be an object' }
    const unexpectedOutput = unknownField(value.output, OUTPUT_KEYS)
    if (unexpectedOutput !== undefined) return { ok: false, error: `filmConfig.output.${unexpectedOutput} is not supported` }
    const output = { ...DEFAULT_OUTPUT }
    for (const key of OUTPUT_KEYS) {
      if (!Object.hasOwn(value.output, key)) continue
      const number = value.output[key]
      const valid = typeof number === 'number' && Number.isFinite(number) && number > 0 && number <= (key === 'fps' ? 240 : 8192)
      if (!valid || (key !== 'fps' && !Number.isInteger(number))) return { ok: false, error: `filmConfig.output.${key} is invalid` }
      output[key] = number
    }
    config.output = output
  }
  if (Object.hasOwn(value, 'cast')) {
    const cast = value.cast
    if (!isRecord(cast)) return { ok: false, error: 'filmConfig.cast must be an object' }
    const unexpectedCast = unknownField(cast, CAST_KEYS)
    if (unexpectedCast !== undefined) return { ok: false, error: `filmConfig.cast.${unexpectedCast} is not supported` }
    for (const key of CAST_KEYS) {
      const list = cast[key]
      if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== 'string'))) {
        return { ok: false, error: `filmConfig.cast.${key} must be a string array` }
      }
    }
    config.cast = cast
  }
  return { ok: true, config }
}

function parseRenderRequest(body: unknown): RenderRequestResult {
  if (!isRecord(body)) return { ok: false, error: 'request body must be an object' }
  const unexpected = unknownField(body, ['demoId', 'boardJson', 'filmConfig'])
  if (unexpected !== undefined) return { ok: false, error: `${unexpected} is not supported` }
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
