import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseKicadPcb } from '@silk-reel/ingest'
import type { BoardModel } from '@silk-reel/ingest'
import { compileTimeline } from '@silk-reel/choreo'
import type { CastHints, FilmConfig, Timeline } from '@silk-reel/choreo'
import type { FilmInputProps } from '@silk-reel/render'

export const DEMO_BOARDS = [
  'ecc83-pp',
  'kit-dev-coldfire-xilinx_5213',
  'video',
  'StickHub',
  'icebreaker',
  'glasgow'
] as const
export type DemoBoardId = (typeof DEMO_BOARDS)[number]

/** per-board cast curation — the art director's pick of hero footprints/labels */
const HERO_HINTS: Partial<Record<DemoBoardId, CastHints>> = {
  icebreaker: {
    preferRefs: ['P1', 'SW1', 'SW2', 'SW3', 'SW4', 'J31', 'J33', 'J34', 'U4', 'U5', 'U6'],
    preferTexts: ['iCEBreaker', 'V1.0e', 'FPGA', 'FLASH', 'PMOD1A', 'PMOD1B', 'RGBLED', 'WS2812']
  },
  glasgow: {
    preferRefs: ['J4', 'J2', 'J3', 'J1', 'J5', 'J10', 'U1', 'SW1'],
    preferTexts: ['ADC A', 'ADC B', 'AUX', 'ACT', '5V', '3V3', '1V2', 'LVDS']
  }
}

export function isDemoBoardId(value: string): value is DemoBoardId {
  return (DEMO_BOARDS as readonly string[]).includes(value)
}

const boardsRoot = path.resolve(import.meta.dirname, '../../../fixtures/boards')

const cache = new Map<string, BoardModel>()

export async function loadDemoBoard(demoId: string): Promise<BoardModel> {
  if (!isDemoBoardId(demoId)) {
    throw new Error(`unknown demo board ${demoId}`)
  }
  const cached = cache.get(demoId)
  if (cached) return cached
  const text = await readFile(path.join(boardsRoot, `${demoId}.kicad_pcb`), 'utf8')
  const board = parseKicadPcb(text, `${demoId}.kicad_pcb`)
  cache.set(demoId, board)
  return board
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function boardFromJson(boardJson: unknown): BoardModel {
  if (!isRecord(boardJson)) {
    throw new Error('boardJson must be a BoardModel object')
  }
  const arrayFields = ['outline', 'layers', 'footprints', 'drill', 'nets', 'warnings']
  const objectFields = ['source', 'bbox', 'copper', 'silkscreen', 'stats']
  if (!arrayFields.every((field) => Array.isArray(boardJson[field])) || !objectFields.every((field) => isRecord(boardJson[field]))) {
    throw new Error('boardJson must be a BoardModel object')
  }
  return boardJson as unknown as BoardModel
}

export function compileFilm(board: BoardModel, config: FilmConfig): { timeline: Timeline; inputProps: FilmInputProps } {
  const timeline = compileTimeline(board, config)
  return { timeline, inputProps: { timeline } }
}

export function defaultFilmConfig(demoId?: string): FilmConfig {
  const cast = isDemoBoardId(demoId ?? '') ? HERO_HINTS[demoId as DemoBoardId] : undefined
  return {
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 15 },
    ...(cast !== undefined ? { cast } : {})
  }
}
