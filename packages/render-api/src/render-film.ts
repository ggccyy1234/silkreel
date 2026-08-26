import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import type { FilmInputProps } from '@silk-reel/render'

export interface RenderFilmOptions {
  entryPoint?: string
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
  const bundleLocation = await bundle({ entryPoint, onProgress: () => undefined })
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
    ffmpegOverride: ({ args }) => [...args, '-pix_fmt', 'yuv420p'],
    chromiumOptions: { gl: 'angle' },
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100)
      if (pct % 20 === 0) options.onProgress?.(pct)
    }
  })
  return { bundleLocation, outputLocation: options.outputLocation }
}
