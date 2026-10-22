// Shimmer probe: how much each pixel jitters frame to frame beyond smooth motion.
// Per frame it takes the mean |f[n] - (f[n-1] + f[n+1]) / 2| in 8-bit luma at
// native resolution. Smooth motion and fades score near 0; sparkle, crawl and
// strobe score high. Frames next to a hard cut are skipped.
// usage: npx tsx scripts/flicker.mts video.mp4 [more.mp4 ...]
import { spawn } from 'node:child_process'

async function probe(file: string): Promise<{ w: number; h: number; fps: number }> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', file])
  const [w, h, rate] = out.toString().trim().split(',')
  const [num, den] = (rate ?? '30/1').split('/').map(Number)
  return { w: Number(w), h: Number(h), fps: (num ?? 30) / (den ?? 1) }
}

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args)
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} exited ${code}`))))
  })
}

for (const file of process.argv.slice(2)) {
  const { w, h, fps } = await probe(file)
  const raw = await run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
  const size = w * h
  const n = Math.floor(raw.length / size)
  const at = (f: number): Buffer => raw.subarray(f * size, (f + 1) * size)
  const step = new Array<number>(n).fill(0)
  for (let f = 1; f < n; f++) {
    const a = at(f - 1)
    const b = at(f)
    let s = 0
    for (let i = 0; i < size; i += 4) s += Math.abs((b[i] as number) - (a[i] as number))
    step[f] = s / (size / 4)
  }
  const cut = (f: number): boolean => (step[f] as number) > 12
  const jitter: number[] = []
  for (let f = 1; f + 1 < n; f++) {
    if (cut(f) || cut(f + 1)) continue
    const a = at(f - 1)
    const b = at(f)
    const c = at(f + 1)
    let s = 0
    for (let i = 0; i < size; i++) s += Math.abs((b[i] as number) - ((a[i] as number) + (c[i] as number)) / 2)
    jitter[f] = s / size
  }
  const perSecond: string[] = []
  for (let s0 = 0; s0 < n; s0 += Math.round(fps)) {
    const xs = jitter.slice(s0, s0 + Math.round(fps)).filter((x) => x !== undefined)
    perSecond.push(xs.length === 0 ? '  -  ' : (xs.reduce((p, q) => p + q, 0) / xs.length).toFixed(3))
  }
  const all = jitter.filter((x) => x !== undefined)
  const mean = all.reduce((p, q) => p + q, 0) / Math.max(1, all.length)
  const sorted = [...all].sort((p, q) => p - q)
  console.log(`${file}\n  jitter mean ${mean.toFixed(3)}  p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(3)}  cuts ${step.filter((x) => x > 12).length}\n  per second: ${perSecond.join(' ')}`)
}
