// trace look-loop: stills of the lit trace renderer at chosen phases, one sheet per board
// usage: npx tsx scripts/trace-stills.mts glasgow,icebreaker 4:5 0.05,0.3,0.62,0.9 [out]
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import type { OpenGlRenderer } from '@remotion/renderer'
import { ASPECT_SIZE, compileTimeline } from '../packages/choreo/src/index.ts'
import type { Aspect, FilmConfig } from '../packages/choreo/src/index.ts'
import { loadDemoBoard, defaultFilmConfig } from '../packages/render-api/src/boards.ts'

const root = path.resolve(import.meta.dirname, '..')
const [boardsArg = 'glasgow', aspect = '4:5', atArg = '0.05,0.3,0.62,0.9', outArg = 'review/trace-stills'] = process.argv.slice(2)
const out = path.resolve(root, outArg)
mkdirSync(out, { recursive: true })
const chromiumOptions = { gl: (process.env.SILK_REEL_GL ?? 'angle') as OpenGlRenderer }
const serveUrl = await bundle({ entryPoint: path.join(root, 'packages/render/src/remotion-entry.tsx'), onProgress: () => undefined })
try {
  for (const board of boardsArg.split(',')) {
    const size = ASPECT_SIZE[aspect as Aspect]
    const config = { ...defaultFilmConfig(board), style: 'trace', aspect, output: { ...defaultFilmConfig(board).output, ...size } } as unknown as FilmConfig
    const timeline = compileTimeline(await loadDemoBoard(board), config)
    const inputProps = { timeline }
    const composition = await selectComposition({ serveUrl, id: 'film', inputProps })
    const files: string[] = []
    for (const at of atArg.split(',').map(Number)) {
      const file = path.join(out, `${board}-${aspect.replace(':', 'x')}-${at}.png`)
      const t0 = Date.now()
      await renderStill({ composition, serveUrl, inputProps, frame: Math.round(at * (timeline.totalFrames - 1)), output: file, imageFormat: 'png', chromiumOptions })
      console.log(path.relative(root, file), `${Date.now() - t0}ms`)
      files.push(file)
    }
    const sheet = path.join(out, `${board}-${aspect.replace(':', 'x')}-sheet.png`)
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]scale=-1:900[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}hstack=${files.length}`, sheet])
    console.log(path.relative(root, sheet))
  }
} finally {
  rmSync(serveUrl, { recursive: true, force: true })
}
