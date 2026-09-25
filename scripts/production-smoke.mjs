import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const studioDist = path.join(root, 'packages/studio/dist')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function createFakeRenderApi() {
  const requests = []
  let finishDownload
  let disconnected
  const downloadDisconnected = new Promise((resolve) => { disconnected = resolve })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://render-api')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ method: req.method, path: url.pathname, body: Buffer.concat(chunks).toString('utf8') })

    if (req.method === 'POST' && url.pathname === '/render') {
      json(res, 202, { jobId: 'job-1', status: 'pending' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/job/job-1') {
      json(res, 200, { status: 'done', progress: 100 })
      return
    }
    if (req.method === 'POST' && url.pathname === '/job/job-1/cancel') {
      json(res, 200, { status: 'cancelled', progress: 0 })
      return
    }
    if (req.method === 'GET' && url.pathname === '/download/job-1') {
      res.statusCode = 200
      res.setHeader('content-type', 'video/mp4')
      res.setHeader('content-disposition', 'attachment; filename="job-1.mp4"')
      res.write('fake-')
      finishDownload = () => res.end('mp4')
      return
    }
    if (req.method === 'GET' && url.pathname === '/download/cancel-me') {
      res.setHeader('content-type', 'video/mp4')
      res.once('close', disconnected)
      res.write('partial')
      return
    }
    json(res, 404, { error: 'not found' })
  })
  return { server, requests, downloadDisconnected, finishDownload: () => finishDownload?.() }
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('fake render API did not expose a TCP address'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

function stop(child) {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    if (child.pid !== undefined && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    } else {
      child.kill('SIGTERM')
    }
  })
}

async function waitForPreview(url, child) {
  const deadline = Date.now() + 20000
  let lastError
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`studio preview exited with code ${child.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.status < 500) return
      lastError = new Error(`preview returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`studio preview did not start: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await filesUnder(entryPath))
    } else {
      files.push(entryPath)
    }
  }
  return files
}

async function reservePort() {
  const server = createServer()
  const port = await listen(server)
  await close(server)
  return port
}

async function request(baseUrl, pathname, init = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${pathname}`, init)
  assert.equal(response.status, expectedStatus, `${init.method ?? 'GET'} ${pathname}`)
  return response
}

async function main() {
  await run(npmCommand, ['run', 'build', '--workspace=@silk-reel/studio'])

  const builtFiles = (await filesUnder(studioDist)).map((file) => path.relative(studioDist, file).split(path.sep).join('/'))
  for (const prohibited of ['canonical.mp4', 'reference/', 'gerber/']) {
    assert.equal(builtFiles.some((file) => file === prohibited || file.startsWith(prohibited)), false, `dist contains prohibited fixture ${prohibited}`)
  }

  const fake = createFakeRenderApi()
  const renderApiPort = await listen(fake.server)
  const studioPort = await reservePort()
  const studioUrl = `http://127.0.0.1:${studioPort}`
  const studio = spawn(npmCommand, ['run', 'start', '--workspace=@silk-reel/studio'], {
    cwd: root,
    env: { ...process.env, STUDIO_PORT: String(studioPort), RENDER_API_URL: `http://127.0.0.1:${renderApiPort}` },
    stdio: 'ignore',
    detached: process.platform !== 'win32'
  })

  try {
    await waitForPreview(studioUrl, studio)

    const home = await request(studioUrl, '/', {})
    assert.match(await home.text(), /<title>silk reel<\/title>/)

    const demos = await request(studioUrl, '/api/demos', {})
    assert.ok((await demos.json()).demos.includes('ecc83-pp'))

    const wrongMethod = await request(studioUrl, '/api/parse', {}, 405)
    assert.match((await wrongMethod.json()).error, /not allowed/)

    const demo = await request(studioUrl, '/api/demo/ecc83-pp', {})
    assert.ok(Array.isArray((await demo.json()).outline))

    const contents = await readFile(path.join(root, 'fixtures/boards/ecc83-pp.kicad_pcb'), 'utf8')
    const parsed = await request(studioUrl, '/api/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'kicad', fileName: 'ecc83-pp.kicad_pcb', contents })
    })
    assert.ok(Array.isArray((await parsed.json()).outline))

    const exported = await request(studioUrl, '/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoId: 'ecc83-pp' })
    }, 202)
    assert.equal((await exported.json()).jobId, 'job-1')

    const job = await request(studioUrl, '/api/job/job-1', {})
    assert.equal((await job.json()).status, 'done')

    const cancelled = await request(studioUrl, '/api/job/job-1/cancel', { method: 'POST' })
    assert.equal((await cancelled.json()).status, 'cancelled')

    const download = await request(studioUrl, '/api/download/job-1', { signal: AbortSignal.timeout(5000) })
    const reader = download.body.getReader()
    const firstChunk = await reader.read()
    assert.equal(Buffer.from(firstChunk.value).toString(), 'fake-')
    fake.finishDownload()
    let downloaded = 'fake-'
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      downloaded += Buffer.from(chunk.value).toString()
    }
    assert.equal(downloaded, 'fake-mp4')
    assert.equal(download.headers.get('content-type'), 'video/mp4')
    assert.match(download.headers.get('content-disposition') ?? '', /job-1\.mp4/)

    const cancellation = new AbortController()
    const partial = await request(studioUrl, '/api/download/cancel-me', { signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(5000)]) })
    assert.equal(Buffer.from((await partial.body.getReader().read()).value).toString(), 'partial')
    cancellation.abort()
    let disconnectTimeout
    try {
      await Promise.race([
        fake.downloadDisconnected,
        new Promise((_, reject) => {
          disconnectTimeout = setTimeout(() => reject(new Error('download cancellation did not close upstream')), 5000)
        })
      ])
    } finally {
      clearTimeout(disconnectTimeout)
    }

    assert.deepEqual(fake.requests.map(({ method, path: requestPath }) => `${method} ${requestPath}`), ['POST /render', 'GET /job/job-1', 'POST /job/job-1/cancel', 'GET /download/job-1', 'GET /download/cancel-me'])
    assert.equal(fake.requests[2]?.body, '')
    console.log('production smoke passed')
  } finally {
    fake.finishDownload()
    await stop(studio)
    fake.server.closeAllConnections()
    await close(fake.server)
  }
}

await main()
