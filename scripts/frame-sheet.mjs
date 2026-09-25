#!/usr/bin/env node
// Extract a grid of frames from a render for visual inspection.
// usage: node scripts/frame-sheet.mjs <video.mp4> [frames=12] [--out dir]
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const video = args.find((a) => !a.startsWith('--'))
if (!video) {
  console.error('usage: node scripts/frame-sheet.mjs <video.mp4> [frames] [--out dir]')
  process.exit(2)
}
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 12)
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join('exports', `sheet-${path.basename(video, '.mp4')}`)

const probe = execFileSync('ffprobe', [
  '-v', 'quiet', '-print_format', 'json', '-show_streams', video
], { encoding: 'utf8' })
const stream = JSON.parse(probe).streams.find((s) => s.codec_type === 'video')
const [num, den] = (stream.r_frame_rate ?? '15/1').split('/').map(Number)
const fps = den > 0 ? num / den : 15
const frames = Math.max(1, Math.round(Number(stream.nb_frames ?? stream.duration * fps)))

mkdirSync(outDir, { recursive: true })
const step = Math.max(1, Math.floor(frames / count))
for (let i = 0; i < count; i++) {
  const f = Math.min(frames - 1, i * step)
  const t = (f / fps).toFixed(3)
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-ss', t, '-i', video,
    '-frames:v', '1',
    path.join(outDir, `f${String(f).padStart(4, '0')}.png`)
  ])
}
// contact sheet (frame files are named by source frame, so glob not %04d)
const cols = Math.ceil(Math.sqrt(count))
execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  '-framerate', '1', '-pattern_type', 'glob',
  '-i', path.join(outDir, 'f*.png'),
  '-filter_complex', `tile=${cols}x${Math.ceil(count / cols)}`,
  path.join(outDir, 'sheet.png')
])
console.log(`frames -> ${outDir}`)
