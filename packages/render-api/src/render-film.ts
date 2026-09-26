import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { OpenGlRenderer } from '@remotion/renderer'
import type { FilmInputProps } from '@silk-reel/render'
import { execFile } from 'node:child_process'
import { rename, rm } from 'node:fs/promises'
import os from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type OutputFormat = 'mp4' | 'gif' | 'webm-alpha' | 'prores-alpha'
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['mp4', 'gif', 'webm-alpha', 'prores-alpha']
export const FORMAT_EXT: Record<OutputFormat, string> = { mp4: 'mp4', gif: 'gif', 'webm-alpha': 'webm', 'prores-alpha': 'mov' }
export const FORMAT_MIME: Record<OutputFormat, string> = {
  mp4: 'video/mp4',
  gif: 'image/gif',
  'webm-alpha': 'video/webm',
  'prores-alpha': 'video/quicktime'
}
export const isAlphaFormat = (format: OutputFormat): boolean => format === 'webm-alpha' || format === 'prores-alpha'

function codecOptions(format: OutputFormat) {
  switch (format) {
    case 'mp4': return { codec: 'h264' as const, crf: 16, pixelFormat: 'yuv420p' as const, imageFormat: 'png' as const }
    case 'gif': return { codec: 'gif' as const, everyNthFrame: 2, imageFormat: 'png' as const }
    case 'webm-alpha': return { codec: 'vp9' as const, pixelFormat: 'yuva420p' as const, imageFormat: 'png' as const }
    case 'prores-alpha': return { codec: 'prores' as const, proResProfile: '4444' as const, pixelFormat: 'yuva444p10le' as const, imageFormat: 'png' as const }
  }
}

export interface RenderFilmOptions {
  entryPoint?: string
  bundleLocationOverride?: string
  inputProps: FilmInputProps
  outputLocation: string
  format?: OutputFormat
  /** output scale factor (GIFs are capped at 720px wide) */
  scale?: number
  onProgress?: (pct: number) => void
}

export interface RenderFilmResult {
  bundleLocation: string
  outputLocation: string
}

export async function renderFilm(options: RenderFilmOptions): Promise<RenderFilmResult> {
  const entryPoint =
    options.entryPoint ?? new URL('../../render/src/remotion-entry.tsx', import.meta.url).pathname
  const bundleLocation = options.bundleLocationOverride ?? (await bundle({ entryPoint, onProgress: () => undefined }))
  const format = options.format ?? 'mp4'
  if (isAlphaFormat(format) && !options.inputProps.timeline.transparent) {
    throw new Error(`${format} needs a transparent timeline (compile with transparent: true)`)
  }
  const inputProps = (format === 'gif' ? { ...options.inputProps, grain: false } : options.inputProps) as unknown as Record<string, unknown>
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'film',
    inputProps
  })
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    inputProps,
    ...codecOptions(format),
    outputLocation: options.outputLocation,
    scale: options.scale ?? 1,
    concurrency: Number(process.env.SILK_REEL_CONCURRENCY) || Math.max(1, Math.floor(os.cpus().length / 2)),
    // angle uses the real GPU for the WebGL2 post pass; SILK_REEL_GL=swangle for GPU-less CI/servers
    chromiumOptions: { gl: (process.env.SILK_REEL_GL ?? 'angle') as OpenGlRenderer },
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100)
      if (pct % 20 === 0) options.onProgress?.(pct)
    }
  })
  if (format === 'mp4') await normalizeMp4(options.outputLocation)
  return { bundleLocation, outputLocation: options.outputLocation }
}

async function normalizeMp4(outputLocation: string): Promise<void> {
  const normalized = `${outputLocation}.normalized.mp4`
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      outputLocation,
      '-map',
      '0:v:0',
      '-an',
      '-c',
      'copy',
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-movflags',
      '+faststart',
      normalized
    ])
    await rename(normalized, outputLocation)
  } finally {
    await rm(normalized, { force: true })
  }
}
