import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { auditInput, requireComplete, runKiCad } from './prepare.js'
import type { PrepareOptions } from './prepare.js'
import { sha256 } from './audit.js'
import { readStack } from './manufacturing.js'
import { requireQualifiedStack } from './compatibility.js'
import type { Audit } from './types.js'

/** Native, audited export. No model-name or extension substitution is enabled. */
export async function exportStep(options: PrepareOptions): Promise<{ step: string; pcb: string; audit: Audit }> {
  const { audit, stagedSource, kicad } = await auditInput(options)
  await mkdir(options.out, { recursive: true })
  await writeFile(path.join(options.out, 'audit.json'), JSON.stringify(audit, null, 2))
  requireComplete(audit)
  requireQualifiedStack(readStack(stagedSource))
  const unsupported = audit.models.filter(m => m.visible && !/\.(step|stp|igs|iges)$/i.test(m.resolved ?? ''))
  if (unsupported.length) throw new Error(`Native STEP export cannot retain these declared models: ${unsupported.map(m => m.ref + ': ' + m.source).join(', ')}`)
  const sourceDir = path.join(options.out, 'source')
  await mkdir(sourceDir, { recursive: true })
  const pcb = path.join(sourceDir, path.basename(options.input))
  await copyFile(options.input, pcb)
  const staged = path.join(sourceDir, 'export-source.kicad_pcb')
  await writeFile(staged, stagedSource)
  try {
    const pro = options.input.replace(/\.kicad_pcb$/i, '.kicad_pro')
    await copyFile(pro, staged.replace(/\.kicad_pcb$/, '.kicad_pro'))
    await copyFile(pro, pcb.replace(/\.kicad_pcb$/, '.kicad_pro'))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const step = path.join(options.out, 'assembly.step')
  process.stdout.write(`Exporting ${audit.models.filter(m => m.visible).length} declared native models with KiCad\n`)
  const log = await runKiCad(kicad, ['pcb', 'export', 'step', '--force', '--include-tracks', '--include-pads',
    '--include-zones', '--include-silkscreen', '--include-soldermask', '-o', step, staged])
  await writeFile(path.join(options.out, 'kicad-step-export.log'), log)
  if (sha256(await readFile(pcb)) !== audit.sha256 || sha256(await readFile(options.input)) !== audit.sha256) throw new Error('PCB changed during STEP export')
  await writeFile(path.join(options.out, 'step-source.json'), JSON.stringify({ pcb: audit.input, pcbSha256: audit.sha256,
    stepSha256: sha256(await readFile(step)), modelSubstitution: false, innerCopper: 'separate native fabrication contours' }, null, 2))
  return { step, pcb, audit }
}
