import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { inspectEnvironment } from './environment.js'

const HELP = `Usage: npm run cad:doctor -- [--json] [--strict] [--out DIR]

Checks Node, KiCad/kicad-cli, pcbnew Python, OpenCascade, browser, FFmpeg,
KiCad model directories and JLC3D. Writes environment.json and prints the
commands needed for missing dependencies. --strict exits non-zero if the
required render environment is incomplete.
`

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    python: { type: 'string' }, browser: { type: 'string' }, ffmpeg: { type: 'string' },
    out: { type: 'string' }, json: { type: 'boolean' }, strict: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  } })
  if (values.help) {
    console.log(HELP)
    return
  }
  const report = await inspectEnvironment({ python: values.python, browser: values.browser, ffmpeg: values.ffmpeg })
  const out = path.resolve(values.out ?? path.join('exports', 'environment'))
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'environment.json'), JSON.stringify(report, null, 2))
  if (values.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`Environment ready: ${report.ready}`)
    console.log(`KiCad: ${report.kiCad.path ?? 'missing'} ${report.kiCad.version ?? ''}`)
    console.log(`pcbnew: ${report.pcbnew.path ?? 'missing'}`)
    console.log(`OpenCascade: ${report.openCascade.path ?? 'missing'}`)
    console.log(`Browser: ${report.browser.path ?? 'missing'}`)
    console.log(`FFmpeg: ${report.ffmpeg.path ?? 'missing'}`)
    console.log(`JLC download path: ${report.jlc.downloadPath ?? 'not configured'}`)
    for (const command of report.fixCommands) console.log(`Fix: ${command}`)
  }
  if (values.strict && !report.ready) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
