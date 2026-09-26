import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { OpenGlRenderer } from '@remotion/renderer'
import type { FilmInputProps } from '@silk-reel/render'
import { execFile } from 'node:child_process'
import { rename, rm } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface RenderFilmOptions {
  entryPoint?: string
  bundleLocationOverride?: string
  inputProps: FilmInputProps
  outputLocation: string
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
  const inputProps = options.inputProps as unknown as Record<string, unknown>
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'film',
    inputProps
  })
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    inputProps,
    codec: 'h264',
    outputLocation: options.outputLocation,
    imageFormat: 'png',
    concurrency: 1,
    ffmpegOverride: ({ args }) => [...args, '-pix_fmt', 'yuv420p'],
    // angle uses the real GPU for the WebGL2 post pass; SILK_REEL_GL=swangle for GPU-less CI/servers
    chromiumOptions: { gl: (process.env.SILK_REEL_GL ?? 'angle') as OpenGlRenderer },
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100)
      if (pct % 20 === 0) options.onProgress?.(pct)
    }
  })
  await normalizeMp4(options.outputLocation)
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
