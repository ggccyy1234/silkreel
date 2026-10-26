import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { repoRoot } from './native.js'

// Authored synthetic geometry, never a substitute for a user's board/models.
const source = await readFile(path.join(repoRoot, 'fixtures/cad/assembly.kicad_pcb'), 'utf8')
const out = path.resolve(process.argv[2] ?? 'exports/cad-fixtures')
await mkdir(out, { recursive: true })
for (const count of [4, 6]) {
  const inner = Array.from({ length: count - 2 }, (_, i) => `(${i + 1} "In${i + 1}.Cu" signal)`).join(' ')
  const copper = ['F.Cu', ...Array.from({ length: count - 2 }, (_, i) => `In${i + 1}.Cu`), 'B.Cu']
  const dielectric = (1.6 - count * 0.035) / (count - 1)
  const stack = copper.map((name, i) => `(layer "${name}" (type "copper") (thickness 0.035))` +
    (i === copper.length - 1 ? '' : `(layer "dielectric ${i + 1}" (type "core") (thickness ${dielectric}))`)).join('\n')
  let board = source.replace('(0 "F.Cu" signal) (31 "B.Cu" signal)', `(0 "F.Cu" signal) ${inner} (31 "B.Cu" signal)`)
    .replace('(setup (pad_to_mask_clearance 0))', `(setup (pad_to_mask_clearance 0) (stackup ${stack}))`)
  const tracks = copper.slice(1, -1).map((name, i) => `(segment (start 105 ${106 + i * 2}) (end 135 ${106 + i * 2}) (width 0.7) (layer "${name}") (net 1))`).join('\n')
  const end = board.lastIndexOf(')')
  board = board.slice(0, end) + tracks + board.slice(end)
  await writeFile(path.join(out, `assembly-${count}layer.kicad_pcb`), board)
}
process.stdout.write(`Synthetic 4/6-layer fixtures: ${out}\n`)
