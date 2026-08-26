import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ServerResponse } from 'node:http'
import { isDemoId, loadDemoBoard, parseKicadText } from './board-server.js'
import { DEMO_IDS } from './board-server.js'

const RENDER_API = 'http://127.0.0.1:3102'
const PORT = 3101

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: Connect.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
    if (chunks.reduce((n, c) => n + c.length, 0) > 64 * 1024 * 1024) {
      throw new Error('payload too large')
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

interface ParseBody {
  kind?: string
  fileName?: string
  contents?: string
}

async function proxyToRenderApi(req: Connect.IncomingMessage, res: ServerResponse, targetPath: string): Promise<void> {
  try {
    const method = req.method ?? 'GET'
    const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : undefined
    const upstream = await fetch(`${RENDER_API}${targetPath}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body } : {})
    })
    res.statusCode = upstream.status
    const contentType = upstream.headers.get('content-type') ?? 'application/json'
    res.setHeader('content-type', contentType)
    if (upstream.headers.get('content-disposition')) {
      res.setHeader('content-disposition', upstream.headers.get('content-disposition') ?? '')
    }
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.end(buffer)
  } catch (err) {
    json(res, 502, { error: `render-api unreachable: ${err instanceof Error ? err.message : String(err)}` })
  }
}

const middleware: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url ?? '/'
  const isApi = url === '/api/demos' || url.startsWith('/api/demo/') || url === '/api/parse' || url.startsWith('/api/export') || url.startsWith('/api/job/') || url.startsWith('/api/download/')
  if (!isApi) {
    next()
    return
  }
  void handle(req, res, next).catch((err: unknown) => {
    if (!res.writableEnded) {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) })
    }
  })
}

const PROXY_MAP: Array<{ match: RegExp; target: (url: string) => string }> = [
  { match: /^\/api\/export$/, target: () => '/render' },
  { match: /^\/api\/job\//, target: (url) => url.replace('/api/job/', '/job/') },
  { match: /^\/api\/download\//, target: (url) => url.replace('/api/download/', '/download/') }
]

function proxyTarget(url: string): { pathname: string; query: string } | undefined {
  const [rawPath, rawQuery = ''] = url.split('?')
  if (rawPath === undefined) return undefined
  for (const rule of PROXY_MAP) {
    if (rule.match.test(rawPath)) {
      return { pathname: rule.target(rawPath), query: rawQuery !== '' ? `?${rawQuery}` : '' }
    }
  }
  return undefined
}

async function handle(req: Connect.IncomingMessage, res: ServerResponse, next: Connect.NextFunction): Promise<void> {
  const url = req.url ?? '/'
  if (url === '/api/demos' && req.method === 'GET') {
    json(res, 200, { demos: DEMO_IDS })
    return
  }
  if (url.startsWith('/api/demo/') && req.method === 'GET') {
    const demoId = decodeURIComponent(url.slice('/api/demo/'.length).split('?')[0] ?? '')
    if (!isDemoId(demoId)) {
      json(res, 404, { error: `unknown demo board ${demoId}` })
      return
    }
    const board = await loadDemoBoard(demoId)
    json(res, 200, board)
    return
  }
  if (url === '/api/parse' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req)) as ParseBody
    if (body.kind !== 'kicad' || typeof body.contents !== 'string' || typeof body.fileName !== 'string') {
      json(res, 400, { error: 'expected { kind: "kicad", fileName, contents }' })
      return
    }
    const board = parseKicadText(body.fileName, body.contents)
    json(res, 200, board)
    return
  }
  const upstream = proxyTarget(url)
  if (upstream !== undefined) {
    await proxyToRenderApi(req, res, `${upstream.pathname}${upstream.query}`)
    return
  }
  next()
}

const studioApiPlugin: Plugin = {
  name: 'silk-reel-studio-api',
  configureServer(server) {
    server.middlewares.use(middleware)
  }
}

const server: ViteDevServer = await createServer({
  configFile: false,
  root: new URL('..', import.meta.url).pathname,
  plugins: [react(), studioApiPlugin],
  server: { port: PORT, strictPort: true },
  appType: 'spa'
})

await server.listen()
console.log(`studio listening on http://localhost:${PORT}`)
