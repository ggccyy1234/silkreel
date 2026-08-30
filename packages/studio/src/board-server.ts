import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseKicadPcb, UnsupportedFormatError } from '@silk-reel/ingest'
import type { BoardModel } from '@silk-reel/ingest'

const DEMO_IDS = ['ecc83-pp', 'kit-dev-coldfire-xilinx_5213', 'video'] as const
export type DemoId = (typeof DEMO_IDS)[number]

export function isDemoId(value: string): value is DemoId {
  return (DEMO_IDS as readonly string[]).includes(value)
}

const boardsRoot = path.resolve(import.meta.dirname, '../../../fixtures/boards')
const cache = new Map<string, BoardModel>()

export async function loadDemoBoard(demoId: DemoId): Promise<BoardModel> {
  const cached = cache.get(demoId)
  if (cached) return cached
  const text = await readFile(path.join(boardsRoot, `${demoId}.kicad_pcb`), 'utf8')
  const board = parseKicadPcb(text, `${demoId}.kicad_pcb`)
  cache.set(demoId, board)
  return board
}

export function parseKicadText(fileName: string, contents: string): BoardModel {
  if (/\.kicad_mod$/i.test(fileName)) {
    throw new UnsupportedFormatError(
      fileName,
      'standalone .kicad_mod footprint files are not board inputs and cannot be represented faithfully as BoardModel; upload a .kicad_pcb board'
    )
  }
  return parseKicadPcb(contents, fileName)
}

export { DEMO_IDS }
