import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'

export interface VideoFacts {
  width: number
  height: number
  fps: number
  durationSeconds: number
  frameCount: number | undefined
  codec: string | undefined
  pixFmt: string | undefined
  audioStreamCount: number
}

export interface DecodedFrame {
  index: number
  width: number
  height: number
  data: Uint8Array
}

const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'] as const
const FFPROBE_CANDIDATES = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe'] as const

async function resolveBinary(candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    if (!candidate.includes('/')) return candidate
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(`none of ${candidates.join(', ')} found on this machine`)
}

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  pix_fmt?: string
  width?: number
  height?: number
  r_frame_rate?: string
  duration?: string
  nb_frames?: string
}

export async function probeVideo(videoPath: string): Promise<VideoFacts> {
  const ffprobe = await resolveBinary(FFPROBE_CANDIDATES)
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      videoPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let acc = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c: string) => { acc += c })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(acc)
      else reject(new Error(`ffprobe exited ${code} reading ${videoPath}`))
    })
  })

  let parsed: { streams?: ProbeStream[]; format?: { duration?: string } }
  try {
    parsed = JSON.parse(out) as typeof parsed
  } catch {
    throw new Error(`ffprobe produced unparseable output for ${videoPath}`)
  }
  const video = (parsed.streams ?? []).find((s) => s.codec_type === 'video')
  if (!video || typeof video.width !== 'number' || typeof video.height !== 'number') {
    throw new Error(`no video stream found in ${videoPath}`)
  }

  const fpsParts = (video.r_frame_rate ?? '').split('/')
  const fpsNum = Number(fpsParts[0])
  const fpsDen = Number(fpsParts[1] ?? '1')
  const fps = fpsDen > 0 && Number.isFinite(fpsNum) ? fpsNum / fpsDen : 0
  const durationRaw = parsed.format?.duration ?? video.duration
  const durationSeconds = durationRaw !== undefined && Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : 0
  const nbFrames = video.nb_frames !== undefined && Number.isFinite(Number(video.nb_frames)) ? Number(video.nb_frames) : undefined

  return {
    width: video.width,
    height: video.height,
    fps,
    durationSeconds,
    frameCount: nbFrames,
    codec: video.codec_name,
    pixFmt: video.pix_fmt,
    audioStreamCount: (parsed.streams ?? []).filter((stream) => stream.codec_type === 'audio').length
  }
}

export async function* decodeGrayFrames(
  videoPath: string,
  spec: { width: number; height: number },
  options: { everyNthFrame?: number } = {}
): AsyncGenerator<DecodedFrame> {
  const ffmpeg = await resolveBinary(FFMPEG_CANDIDATES)
  const everyNth = Math.max(1, options.everyNthFrame ?? 1)
  const vf = everyNth > 1 ? `format=gray,select=not(mod(n\\,${everyNth}))` : 'format=gray'

  const child = spawn(ffmpeg, [
    '-nostdin',
    '-i', videoPath,
    '-vf', vf,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-'
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  let stderrTail = ''
  const stderrDrained = new Promise<void>((resolve) => {
    const stream = child.stderr
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4000)
    })
    stream.on('end', () => {
      resolve()
    })
    stream.on('error', () => {
      resolve()
    })
  })

  const stdout = child.stdout
  const frameSize = spec.width * spec.height
  let frameIndex = 0
  const failures: Error[] = []

  try {
    for (;;) {
      const data = await readExact(stdout, frameSize)
      if (data === undefined) break
      yield { index: frameIndex, width: spec.width, height: spec.height, data }
      frameIndex += 1
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await stderrDrained
    const code = await new Promise<number>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(child.exitCode ?? -1)
      } else {
        child.on('close', (c) => {
          resolve(c ?? -1)
        })
      }
    })
    if (code !== 0) {
      const failure = new Error(`ffmpeg exited ${code} decoding ${videoPath}: ${stderrTail.trim()}`)
      failures.push(failure)
    }
  }
  const failure = failures[0]
  if (failure !== undefined) throw failure
}

function readExact(
  stream: NodeJS.ReadableStream,
  size: number
): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let filled = 0
    const finish = (end: boolean): void => {
      cleanup()
      if (filled === size) {
        const merged = new Uint8Array(size)
        let offset = 0
        for (const part of parts) {
          merged.set(part, offset)
          offset += part.length
        }
        resolve(merged)
      } else if (end) {
        resolve(undefined)
      } else {
        reject(new Error(`short read from ffmpeg pipe (${filled}/${size})`))
      }
    }
    const onReadable = (): void => {
      for (;;) {
        const chunk = stream.read(size - filled) as Buffer | null
        if (chunk === null) return
        parts.push(chunk)
        filled += chunk.length
        if (filled === size) {
          finish(false)
          return
        }
      }
    }
    const onEnd = (): void => {
      finish(true)
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const cleanup = (): void => {
      stream.removeListener('readable', onReadable)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
    }
    stream.on('readable', onReadable)
    stream.once('end', onEnd)
    stream.once('error', onError)
    onReadable()
  })
}
