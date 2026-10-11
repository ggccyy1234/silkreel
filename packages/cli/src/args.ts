import path from 'node:path'
import { parseArgs } from 'node:util'
import { ASPECT_SIZE, PALETTES } from '@silk-reel/choreo'
import type { Aspect, FilmConfig, PaletteId, StyleId } from '@silk-reel/choreo'
import { FORMAT_EXT, OUTPUT_FORMATS, defaultFilmConfig, isAlphaFormat } from '@silk-reel/render-api'
import type { OutputFormat } from '@silk-reel/render-api'

export const USAGE = `usage: silk-reel <board.kicad_pcb> [-o out.mp4] [--style trace|glyph]
  [--aspect 4:5|1:1|9:16|16:9] [--palette mono|copper|blueprint|phosphor] [--accent #rrggbb]
  [--title "Name"] [--version v1.0] [--seed N] [--tempo 1] [--density 1]
  [--format mp4|gif|webm-alpha|prores-alpha] [--draft] [--no-audio]`

export interface CliArgs {
  input: string
  out: string
  config: FilmConfig
  format: OutputFormat
  /** one motion-blur sample and lighter maps: a fast look, not a release */
  draft: boolean
  audio: boolean
}

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined
  if (!allowed.includes(value as T)) throw new Error(`--${flag} must be one of ${allowed.join(', ')} (got ${value})`)
  return value as T
}

function num(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`--${flag} must be a number (got ${value})`)
  return n
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      style: { type: 'string' },
      aspect: { type: 'string' },
      palette: { type: 'string' },
      accent: { type: 'string' },
      title: { type: 'string' },
      version: { type: 'string' },
      seed: { type: 'string' },
      tempo: { type: 'string' },
      density: { type: 'string' },
      format: { type: 'string' },
      draft: { type: 'boolean' },
      'no-audio': { type: 'boolean' }
    }
  })
  const input = positionals[0]
  if (input === undefined || positionals.length > 1) throw new Error(USAGE)

  const style = oneOf<StyleId>('style', values.style, ['trace', 'glyph']) ?? 'trace'
  const aspect = oneOf<Aspect>('aspect', values.aspect, Object.keys(ASPECT_SIZE) as Aspect[]) ?? '4:5'
  const palette = oneOf<PaletteId>('palette', values.palette, Object.keys(PALETTES) as PaletteId[])
  const format = oneOf<OutputFormat>('format', values.format, OUTPUT_FORMATS) ?? 'mp4'
  if (values.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(values.accent)) {
    throw new Error(`--accent must be a #rrggbb hex color (got ${values.accent})`)
  }
  if (values.version !== undefined && values.title === undefined) throw new Error('--version needs --title')

  // same base as the studio/render-api: fixture boards pick up their curated cast hints
  const base = defaultFilmConfig(path.basename(input, '.kicad_pcb'))
  const seed = num('seed', values.seed)
  const tempo = num('tempo', values.tempo)
  const density = num('density', values.density)
  const config: FilmConfig = {
    ...base,
    style,
    aspect,
    output: { ...base.output, ...ASPECT_SIZE[aspect] },
    knobs: { ...(tempo !== undefined ? { tempo } : {}), ...(density !== undefined ? { density } : {}) },
    ...(seed !== undefined ? { seed } : {}),
    ...(palette !== undefined ? { palette } : {}),
    ...(values.accent !== undefined ? { accent: values.accent } : {}),
    ...(values.title !== undefined
      ? { title: { name: values.title, ...(values.version !== undefined ? { version: values.version } : {}) } }
      : {}),
    ...(isAlphaFormat(format) ? { transparent: true } : {})
  }
  const out =
    values.out ??
    path.join(path.dirname(input), `${path.basename(input, '.kicad_pcb')}-${style}-${aspect.replace(':', 'x')}.${FORMAT_EXT[format]}`)
  return { input, out, config, format, draft: values.draft === true, audio: values['no-audio'] !== true }
}
