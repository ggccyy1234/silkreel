import { parseArgs } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prepare, auditInput, requireComplete, runKiCad } from './prepare.js'
import { buildViewer, serve } from './web.js'
import { render } from './render.js'
import { prepareManufacturing } from './manufacturing.js'
import { exportStep } from './export-step.js'

const help = `PCB CAD — source-faithful KiCad / STEP renderer

  npm run cad -- render board.kicad_pcb --out exports/board
  npm run cad -- manufacture board.kicad_pcb --out exports/manufacturing
  npm run cad -- render assembly.step --out exports/step
  npm run cad -- audit board.kicad_pcb --out exports/audit
  npm run cad -- prepare assembly.step --out exports/step
  npm run cad -- serve exports/step --port 3103
  npm run cad -- reference board.kicad_pcb --out exports/reference

render writes cover/top/bottom.png, turntable.mp4, model.glb and a local viewer.
prepare writes the portable GLB and viewer without capturing images.
reference writes KiCad's own top/bottom/isometric images for comparison.
Missing visible model files are a hard error; there is no inferred fallback.

  --kicad PATH          KiCad CLI executable (or KICAD_CLI environment variable)
  --python PATH         Python with cadquery-ocp-novtk (or CAD_PYTHON)
  --define NAME=VALUE   Explicit KiCad path variable; repeatable
  --model-map FILE      JSON object: exact original model path -> actual file
  --deflection MM       STEP tessellation linear deflection (default 0.02 mm)
  --width N --height N  Resolution (default 1920 x 1080)
  --duration SEC        Total film duration (turntable 12s; manufacturing auto)
  --pcb PATH            Matching PCB companion for manufacturing (4/6 Cu layers)
  --allow-incomplete-step  Explicitly accept disclosed missing refs in an existing STEP
  --kicad-python PATH   Python with pcbnew for manufacturing contour extraction
  --fps N              Frame rate (default 30)
  --elevation DEG      Camera elevation above board plane (default 55)
  --azimuth DEG        Initial camera azimuth (default -90)
  --side top|bottom    Initial visible board face (default top)
  --background #rrggbb Background color (default #edf0f4)
  --transparent        Transparent PNG; MP4 remains opaque
  --title TEXT         Optional caption
  --still              PNG only, no video
  --browser PATH       Chrome/Edge/Chromium executable
  --ffmpeg PATH        Encoder executable; otherwise use bundled/PATH ffmpeg
  --port N             Local viewer port (default 3103)
`

async function stringMap(file: string): Promise<Record<string, string>> {
  const data: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.values(data).some(value => typeof value !== 'string')) throw new Error('Model map must be a JSON object of original-path: actual-path strings')
  return data as Record<string, string>
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--azimuth' && /^-\d+(?:\.\d+)?$/.test(argv[i + 1] ?? '')) argv.splice(i, 2, `--azimuth=${argv[i + 1]}`)
  }
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, out: { type: 'string', short: 'o' }, kicad: { type: 'string' }, python: { type: 'string' },
    define: { type: 'string', multiple: true }, 'model-map': { type: 'string' }, deflection: { type: 'string' },
    width: { type: 'string' }, height: { type: 'string' }, duration: { type: 'string' }, fps: { type: 'string' },
    elevation: { type: 'string' }, azimuth: { type: 'string' }, side: { type: 'string' }, background: { type: 'string' },
    transparent: { type: 'boolean' }, title: { type: 'string' }, still: { type: 'boolean' },
    browser: { type: 'string' }, ffmpeg: { type: 'string' }, port: { type: 'string' },
    pcb: { type: 'string' }, 'kicad-python': { type: 'string' }, 'allow-incomplete-step': { type: 'boolean' }
  } })
  if (values.help || !positionals.length) { console.log(help); return }
  const command = positionals[0] ?? ''
  if (!['audit', 'prepare', 'render', 'manufacture', 'serve', 'reference'].includes(command)) throw new Error('Expected audit, prepare, render, manufacture, serve or reference. Use --help.')
  if (positionals.length !== 2) throw new Error(`Expected ${command} <input>. Use --help.`)
  const input = path.resolve(positionals[1] ?? '')
  const number = (name: 'width' | 'height' | 'duration' | 'fps' | 'elevation' | 'azimuth' | 'port' | 'deflection', fallback: number, min: number, max: number, integer = false): number => {
    const v = values[name] === undefined ? fallback : Number(values[name])
    if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new Error(`--${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`)
    return v
  }
  if (command === 'serve') {
    const { server, url } = await serve(input, number('port', 3103, 1, 65535, true))
    console.log(`CAD viewer: ${url}\nCtrl+C to stop. Bound to localhost only.`)
    process.once('SIGINT', () => { server.close(); process.exitCode = 0 })
    return
  }
  const out = path.resolve(values.out ?? path.join('exports', 'cad', path.basename(input, path.extname(input))))
  const variables: Record<string, string> = {}
  for (const entry of values.define ?? []) {
    const separator = entry.indexOf('=')
    if (separator < 1) throw new Error(`Expected --define NAME=VALUE, got ${entry}`)
    variables[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  const options = { input, out, kicad: values.kicad, python: values.python, variables,
    modelMap: values['model-map'] ? await stringMap(values['model-map']) : {},
    deflectionMm: number('deflection', 0.02, 0.0001, 1) }
  if (values['allow-incomplete-step'] && (command === 'manufacture' || !values.pcb)) throw new Error('--allow-incomplete-step is only for an existing STEP with --pcb; native manufacture is always strict')
  await mkdir(out, { recursive: true })
  try {
    if (command === 'audit' || command === 'reference') {
      if (path.extname(input).toLowerCase() !== '.kicad_pcb') throw new Error(`${command} requires a .kicad_pcb input`)
      const { audit, stagedSource, kicad } = await auditInput(options)
      await writeFile(path.join(out, 'audit.json'), JSON.stringify(audit, null, 2))
      console.log(`${audit.models.filter(m => m.visible && m.resolved).length} resolved visible model references; ${audit.missing.length} missing; ${audit.withoutModels.length} footprints without a visible model.`)
      requireComplete(audit)
      if (command === 'reference') {
        const staged = path.join(out, 'reference-source.kicad_pcb')
        await writeFile(staged, stagedSource)
        for (const side of ['top', 'bottom', 'iso']) {
          const log = await runKiCad(kicad, ['pcb', 'render', '--width', String(number('width', 1920, 64, 7680, true)),
            '--height', String(number('height', 1080, 64, 7680, true)), '--quality', 'high', '--use-board-stackup-colors',
            '--background', 'opaque', '--side', side === 'bottom' ? 'bottom' : 'top',
            ...(side === 'iso' ? ['--rotate', '35,0,25'] : []), '-o', path.join(out, `kicad-${side}.png`), staged])
          await writeFile(path.join(out, `kicad-${side}.log`), log)
        }
      }
    } else {
      const width = number('width', 1920, 64, 7680, true), height = number('height', 1080, 64, 7680, true)
      if (width % 2 || height % 2) throw new Error('Width and height must be even')
      const side = values.side ?? 'top'
      if (side !== 'top' && side !== 'bottom') throw new Error('--side must be top or bottom')
      const background = values.background ?? '#edf0f4'
      if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error('--background must be #rrggbb')
      console.log(`Preparing exact CAD geometry: ${input}`)
      if (command === 'manufacture' && path.extname(input).toLowerCase() !== '.kicad_pcb') throw new Error('manufacture requires a .kicad_pcb input')
      const exported = command === 'manufacture' ? await exportStep(options) : undefined
      const manifest = await prepare({ ...options, input: exported?.step ?? input })
      if (exported) {
        manifest.audit = exported.audit
        manifest.notes.push(`${exported.audit.withoutModels.length} source footprint(s) declare no visible model; see audit.withoutModels. No bodies invented.`)
      }
      const pcb = exported?.pcb ?? values.pcb
      if (pcb) await prepareManufacturing(out, path.resolve(pcb), manifest, values.kicad, values['kicad-python'], values.title, values['allow-incomplete-step'] ?? false)
      if (exported && manifest.manufacturing?.missingInStep.length) throw new Error(`Native STEP omitted declared components: ${manifest.manufacturing.missingInStep.join(', ')}`)
      console.log(`${manifest.geometry.meshes} meshes / ${manifest.geometry.triangles.toLocaleString()} triangles / ${manifest.geometry.bounds.size.map(v => v.toFixed(3)).join(' × ')} mm`)
      await buildViewer(out)
      // Viewer refuses stale geometry after a failed preparation.
      await writeFile(path.join(out, 'status.json'), JSON.stringify({ ok: true }))
      if (command === 'render' || command === 'manufacture') {
        await render({ out, width, height, elevation: number('elevation', 55, 0.01, 89.99), azimuth: number('azimuth', -90, -360, 360),
          side, background, transparent: values.transparent ?? false, title: values.title ?? '',
          duration: number('duration', manifest.manufacturing?.duration ?? 12, 0.1, 600), fps: number('fps', 30, 1, 120, true),
          film: Boolean(manifest.manufacturing),
          stillOnly: values.still ?? false, browser: values.browser, ffmpeg: values.ffmpeg,
          onProgress: progress => { console.log(`Render ${progress}%`) } })
      }
    }
    await writeFile(path.join(out, 'status.json'), JSON.stringify({ ok: true }))
    console.log(`Done: ${out}\nViewer: npm run cad -- serve "${out}"`)
  } catch (error) {
    await writeFile(path.join(out, 'status.json'), JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
    throw error
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
