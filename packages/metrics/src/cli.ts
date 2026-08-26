import { readFile, writeFile } from 'node:fs/promises'
import { runGate } from './gate.js'
import type { GateExpectations } from './gate.js'

interface CliArgs {
  video: string
  out?: string | undefined
  specPath?: string | undefined
}

function parseArgs(argv: readonly string[]): CliArgs {
  let video: string | undefined
  let out: string | undefined
  let specPath: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out') {
      out = argv[i + 1]
      i += 1
    } else if (arg === '--spec') {
      specPath = argv[i + 1]
      i += 1
    } else if (video === undefined) {
      video = arg
    }
  }
  if (video === undefined) {
    console.error('usage: tsx src/cli.ts <video.mp4> [--spec expectations.json] [--out report.json]')
    process.exit(2)
  }
  return { video, out, specPath }
}

async function loadExpectations(specPath: string | undefined): Promise<GateExpectations> {
  const fallback: GateExpectations = { width: 1080, height: 1350, fps: 15, totalFrames: Math.round(12.733 * 15) }
  if (specPath === undefined) return fallback
  const raw = await readFile(specPath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<GateExpectations>
  if (
    typeof parsed.width !== 'number' ||
    typeof parsed.height !== 'number' ||
    typeof parsed.fps !== 'number' ||
    typeof parsed.totalFrames !== 'number'
  ) {
    throw new Error('spec file must provide width, height, fps, totalFrames as numbers')
  }
  return parsed as GateExpectations
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const expectations = await loadExpectations(args.specPath)
  try {
    const report = await runGate(args.video, expectations)
    const json = JSON.stringify(report, null, 2)
    if (args.out !== undefined) {
      await writeFile(args.out, `${json}\n`, 'utf8')
    }
    console.log(json)
    process.exit(report.passed ? 0 : 1)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(JSON.stringify({ passed: false, error: message }, null, 2))
    process.exit(1)
  }
}

void main()
