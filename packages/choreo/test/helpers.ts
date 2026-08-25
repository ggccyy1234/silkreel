import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseKicadPcb } from '@silk-reel/ingest'
import type { BoardModel } from '@silk-reel/ingest'

const boardsDir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'boards')

export function loadBoard(name: string): string {
  return readFileSync(`${boardsDir}/${name}`, 'utf8')
}

export function boardModel(name: string): BoardModel {
  return parseKicadPcb(loadBoard(name), name)
}
