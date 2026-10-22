// Copies the fixture boards into public/boards/ so the studio can parse them in the browser (gitignored).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
const from = new URL('../../../fixtures/boards/', import.meta.url)
const to = new URL('../public/boards/', import.meta.url)
mkdirSync(to, { recursive: true })
for (const f of readdirSync(from)) if (f.endsWith('.kicad_pcb')) copyFileSync(new URL(f, from), new URL(f, to))
