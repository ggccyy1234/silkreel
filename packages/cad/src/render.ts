import { spawn } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { chromium } from 'playwright'
import { serve } from './web.js'
import type { ViewSettings } from './types.js'

export interface RenderOptions extends ViewSettings {
  out: string
  duration: number
  fps: number
  stillOnly: boolean
  browser?: string | undefined
  ffmpeg?: string | undefined
  onProgress?: ((value: number) => void) | undefined
}

export async function findBrowser(explicit?: string): Promise<string> {
  if (explicit) { await access(explicit); return explicit }
  const candidates = [process.env.CAD_BROWSER, chromium.executablePath(),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome']
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch { /* next */ }
  }
  throw new Error('No Chromium browser found. Pass --browser path/to/chrome or run npx playwright install chromium')
}

export async function findFFmpeg(explicit?: string): Promise<string> {
  if (explicit) { await access(explicit); return explicit }
  if (process.env.CAD_FFMPEG) return process.env.CAD_FFMPEG
  const platformPackage = `@remotion/compositor-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''}`
  try {
    const require = createRequire(import.meta.url)
    const binary = path.join(path.dirname(require.resolve(`${platformPackage}/package.json`)), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    await access(binary)
    return binary
  } catch { return 'ffmpeg' }
}

export async function render(options: RenderOptions): Promise<void> {
  if (options.width % 2 || options.height % 2) throw new Error('Video dimensions must be even')
  const executablePath = await findBrowser(options.browser)
  const { server, url } = await serve(options.out)
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let encoder: ReturnType<typeof spawn> | undefined
  try {
    browser = await chromium.launch({ executablePath, headless: true,
      args: ['--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', ...(process.env.SILK_REEL_GL === 'swangle' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])] })
    const page = await browser.newPage({ viewport: { width: options.width, height: options.height }, deviceScaleFactor: 1 })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${url}/?render`, { waitUntil: 'load', timeout: 120000 })
    await page.waitForFunction(() => window.cadReady || window.cadError, undefined, { timeout: 120000 })
    const loadError = await page.evaluate(() => window.cadError)
    if (loadError) throw new Error(loadError)
    const settings: ViewSettings = { width: options.width, height: options.height, elevation: options.elevation,
      azimuth: options.azimuth, side: options.side, background: options.background, transparent: options.transparent, title: options.title,
      film: options.film ?? false }
    let health: ReturnType<NonNullable<Window['cadFrameHealth']>> | undefined
    const frame = async (progress: number, overrides: Partial<ViewSettings> = {}): Promise<Buffer> => {
      const effective = { ...settings, ...overrides }
      health = await page.evaluate(({ progress, settings }) => {
        if (!window.cadFrame) throw new Error('CAD renderer not initialized')
        window.cadFrame(progress, settings)
        if (!window.cadFrameHealth) throw new Error('Missing per-frame geometry check')
        return window.cadFrameHealth()
      }, { progress, settings: effective })
      if (errors.length) throw new Error(errors.join('\n'))
      if (!health.visibleMeshes || health.clipped) throw new Error(`Empty or clipped CAD frame at progress ${progress}: ${JSON.stringify(health)}`)
      return page.screenshot({ type: 'png', omitBackground: effective.transparent, animations: 'disabled' })
    }
    await writeFile(path.join(options.out, 'cover.png'), await frame(0))
    await writeFile(path.join(options.out, 'top.png'), await frame(0, { elevation: 89.99, side: 'top', title: '', film: false }))
    await writeFile(path.join(options.out, 'bottom.png'), await frame(0, { elevation: 89.99, side: 'bottom', title: '', film: false }))
    if (options.film) {
      const data = JSON.parse(await readFile(path.join(options.out, 'manufacturing.json'), 'utf8')) as { duration: number }
      await writeFile(path.join(options.out, 'exploded.png'), await frame(9 / data.duration))
    }
    if (!options.stillOnly) {
      const ffmpeg = await findFFmpeg(options.ffmpeg)
      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(options.fps), '-i', '-',
        '-an', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(options.out, 'turntable.mp4')]
      encoder = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
      const child = encoder
      let encoderError: Error | undefined, log = ''
      child.on('error', e => { encoderError = e })
      child.stderr?.on('data', (chunk: Buffer) => { log += chunk.toString() })
      child.stdin?.on('error', e => { encoderError = e })
      const done = new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => { if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}: ${log}`)) })
      })
      // Attach rejection immediately to avoid an unhandled rejection during a frame.
      void done.catch(() => undefined)
      const frames = Math.round(options.duration * options.fps)
      if (frames < 1) throw new Error('Duration and FPS must produce at least one video frame')
      const audit: { frame: number; progress: number; health: typeof health }[] = []
      for (let i = 0; i < frames; i++) {
        if (encoderError) throw encoderError
        const data = await frame(i / frames, { transparent: false })
        audit.push({ frame: i, progress: i / frames, health })
        if (!child.stdin) throw new Error('ffmpeg stdin was not created')
        if (!child.stdin.write(data)) await Promise.race([once(child.stdin, 'drain'), done.then(() => { throw new Error('ffmpeg closed before all frames were written') })])
        if (i % Math.max(1, Math.floor(frames / 20)) === 0) options.onProgress?.(Math.round(i / frames * 100))
      }
      child.stdin?.end()
      await done
      await writeFile(path.join(options.out, 'frame-audit.json'), JSON.stringify({ schema: 1, expectedFrames: frames,
        capturedFrames: audit.length, fps: options.fps, duration: options.duration,
        checks: ['browser errors', 'visible CAD meshes', 'projected mesh bounds within viewport'],
        limitations: 'Conservative bounding boxes; does not certify pixel quality, occlusion, captions, geometry accuracy or process physics. Agent visual review is required.', frames: audit }))
      options.onProgress?.(100)
    }
    const manifest = JSON.parse(await readFile(path.join(options.out, 'manifest.json'), 'utf8')) as Record<string, unknown>
    manifest.render = { ...settings, duration: options.stillOnly ? 0 : options.duration, fps: options.fps,
      renderer: 'Three.js 0.186.1 / WebGL2', browser: browser.version(), geometryModified: false,
      animation: options.film ? 'manufacturing / exploded assembly; illustrative process transformations' : 'turntable' }
    await writeFile(path.join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2))
  } finally {
    encoder?.kill()
    await Promise.all([browser?.close(), new Promise<void>((resolve, reject) => server.close(error => { if (error) reject(error); else resolve() }))])
  }
}
