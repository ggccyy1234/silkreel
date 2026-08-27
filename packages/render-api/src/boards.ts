import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseKicadPcb } from '@silk-reel/ingest'
import type { BoardModel } from '@silk-reel/ingest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig, Timeline } from '@silk-reel/choreo'
import type { FilmInputProps } from '@silk-reel/render'

export const DEMO_BOARDS = ['ecc83-pp', 'kit-dev-coldfire-xilinx_5213', 'video', 'StickHub'] as const
export type DemoBoardId = (typeof DEMO_BOARDS)[number]

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
  return { timeline, inputProps: { timeline, board } }
}

export function defaultFilmConfig(): FilmConfig {
  return {
    actOrder: [],
    knobs: {},
    seed: 42,
    duration: 'auto',
    output: { width: 1080, height: 1350, fps: 15 }
  }
}
