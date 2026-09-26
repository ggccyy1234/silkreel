#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseKicadPcb } from '@silk-reel/ingest'
import { compileTimeline } from '@silk-reel/choreo'
import { renderFilm } from '@silk-reel/render-api'
import { parseCliArgs } from './args.js'

async function main(): Promise<void> {
  const { input, out, config, format } = parseCliArgs(process.argv.slice(2))
  const board = parseKicadPcb(await readFile(input, 'utf8'), path.basename(input))
  const timeline = compileTimeline(board, config)
  for (const w of timeline.warnings) console.warn(`warning: ${w.message}`)
  console.log(`${timeline.style} ${timeline.width}x${timeline.height} ${timeline.totalFrames}f @${timeline.fps}fps -> ${format}`)
  const outputLocation = path.resolve(out)
  await renderFilm({
    inputProps: { timeline },
    outputLocation,
    format,
    onProgress: (pct) => {
      console.log(`  ${pct}%`)
    }
  })
  console.log(outputLocation)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
