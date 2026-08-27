import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const currentPath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'fixtures/canonical.mp4'))
const referencePath = path.resolve(process.argv[3] ?? path.join(repoRoot, 'fixtures/reference/pcbanimation.mp4'))
const outputDir = path.resolve(process.argv[4] ?? '/tmp/silk-reel-reference-review')
const boundaries = [0, 4, 5, 34, 35, 54, 55, 69, 70, 104, 105, 119, 120, 154, 155, 165, 166]

const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const ffprobe = process.env.FFPROBE ?? 'ffprobe'

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-5000)
    })
    child.stdout.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`))
    })
  })
}

async function probe(file) {
  const output = []
  await new Promise((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      file
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      text = `${text}${chunk}`
    })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code} for ${file}`))
        return
      }
      output.push(JSON.parse(text))
      resolve()
    })
  })
  const parsed = output[0]
  const stream = parsed.streams.find((candidate) => candidate.codec_type === 'video')
  if (!stream) throw new Error(`no video stream in ${file}`)
  const [numerator, denominator = '1'] = String(stream.r_frame_rate ?? '0/1').split('/')
  return {
    width: stream.width,
    height: stream.height,
    fps: Number(numerator) / Number(denominator),
    frames: Number(stream.nb_frames),
    duration: Number(parsed.format?.duration ?? stream.duration)
  }
}

async function extractFrames(input, directory) {
  await mkdir(directory, { recursive: true })
  await run(ffmpeg, [
    '-y',
    '-nostdin',
    '-i', input,
    '-fps_mode', 'vfr',
    path.join(directory, '%03d.png')
  ])
}

async function makeSheet(directory, output) {
  await run(ffmpeg, [
    '-y',
    '-nostdin',
    '-framerate', '1',
    '-i', path.join(directory, '%03d.png'),
    '-vf', 'scale=270:-1,tile=12x14:padding=5:margin=5',
    '-frames:v', '1',
    output
  ])
}

async function makePair(referenceFrame, currentFrame, output) {
  await run(ffmpeg, [
    '-y',
    '-nostdin',
    '-i', referenceFrame,
    '-i', currentFrame,
    '-filter_complex', '[0:v][1:v]hstack=inputs=2',
    '-frames:v', '1',
    output
  ])
}

async function resetOutput(outputDir) {
  await Promise.all([
    rm(path.join(outputDir, 'reference'), { recursive: true, force: true }),
    rm(path.join(outputDir, 'current'), { recursive: true, force: true }),
    rm(path.join(outputDir, 'boundaries'), { recursive: true, force: true }),
    rm(path.join(outputDir, 'reference-sheet.png'), { force: true }),
    rm(path.join(outputDir, 'current-sheet.png'), { force: true }),
    rm(path.join(outputDir, 'manifest.json'), { force: true })
  ])
}

if (!existsSync(referencePath)) throw new Error(`reference file does not exist: ${referencePath}`)
if (!existsSync(currentPath)) throw new Error(`current file does not exist: ${currentPath}`)

const reference = await probe(referencePath)
const current = await probe(currentPath)
const referenceFrames = path.join(outputDir, 'reference')
const currentFrames = path.join(outputDir, 'current')
const pairsDir = path.join(outputDir, 'boundaries')
await resetOutput(outputDir)
await mkdir(pairsDir, { recursive: true })
await extractFrames(referencePath, referenceFrames)
await extractFrames(currentPath, currentFrames)
await Promise.all([
  makeSheet(referenceFrames, path.join(outputDir, 'reference-sheet.png')),
  makeSheet(currentFrames, path.join(outputDir, 'current-sheet.png'))
])

const availableBoundaries = boundaries.filter((frame) => frame < Math.min(reference.frames, current.frames))
await Promise.all(availableBoundaries.map((frame) => makePair(
  path.join(referenceFrames, `${String(frame + 1).padStart(3, '0')}.png`),
  path.join(currentFrames, `${String(frame + 1).padStart(3, '0')}.png`),
  path.join(pairsDir, `frame-${String(frame).padStart(3, '0')}.png`)
)))

const manifest = {
  referencePath,
  currentPath,
  outputDir,
  reference,
  current,
  frameCountMatch: reference.frames === current.frames,
  dimensionsMatch: reference.width === current.width && reference.height === current.height,
  availableBoundaries
}
await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(manifest, null, 2))
