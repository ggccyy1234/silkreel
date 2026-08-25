import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseKicadPcb } from '@silk-reel/ingest'
import type { BoardModel, Vec2 } from '@silk-reel/ingest'

const boardsDir = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'boards')

export function loadBoard(name: string): string {
  return readFileSync(`${boardsDir}/${name}`, 'utf8')
}

export function boardModel(name: string): BoardModel {
  return parseKicadPcb(loadBoard(name), name)
}

export interface SyntheticElement {
  id: string
  kind: ElementKindForTests
  pos: Vec2
  size: number
}

export type ElementKindForTests = 'trace' | 'trace-b' | 'pad' | 'via' | 'zone' | 'text' | 'drill' | 'outline' | 'silk-line'

export function makeSyntheticBoard(elementCount: number): BoardModel {
  const side = Math.ceil(Math.sqrt(elementCount))
  const elements: SyntheticElement[] = []
  for (let i = 0; i < elementCount; i++) {
    const col = i % side
    const row = Math.floor(i / side)
    const bucket = i % 10
    if (bucket < 7) {
      elements.push({ id: `t:${i + 1}`, kind: 'trace', pos: { x: col * 2.54, y: row * 2.54 }, size: 0.3 })
    } else if (bucket < 9) {
      elements.push({ id: `t:${i + 1}`, kind: 'trace-b', pos: { x: col * 2.54, y: row * 2.54 }, size: 0.3 })
    } else {
      elements.push({ id: `tx:${i + 1}`, kind: 'text', pos: { x: col * 2.54, y: row * 2.54 }, size: 1 })
    }
  }
  return syntheticBoardFrom(elements)
}

export function syntheticBoardFrom(elements: SyntheticElement[]): BoardModel {
  const frontTraces = elements
    .filter((e) => e.kind === 'trace')
    .map((e) => ({
      id: e.id,
      points: [
        { x: e.pos.x - e.size / 2, y: e.pos.y },
        { x: e.pos.x + e.size / 2, y: e.pos.y }
      ],
      width: 0.25
    }))
  const backTraces = elements
    .filter((e) => e.kind === 'trace-b')
    .map((e) => ({
      id: e.id,
      points: [
        { x: e.pos.x - e.size / 2, y: e.pos.y },
        { x: e.pos.x + e.size / 2, y: e.pos.y }
      ],
      width: 0.25
    }))
  const texts = elements
    .filter((e) => e.kind === 'text')
    .map((e) => ({
      id: e.id,
      value: `TXT${e.id}`,
      pos: e.pos,
      rot: 0,
      height: 1,
      mirrored: false
    }))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const e of elements) {
    minX = Math.min(minX, e.pos.x)
    minY = Math.min(minY, e.pos.y)
    maxX = Math.max(maxX, e.pos.x)
    maxY = Math.max(maxY, e.pos.y)
  }
  return {
    source: { format: 'kicad', files: ['synthetic.kicad_pcb'], boardName: 'synthetic' },
    bbox: {
      min: { x: Number.isFinite(minX) ? minX - 1 : 0, y: Number.isFinite(minY) ? minY - 1 : 0 },
      max: { x: Number.isFinite(maxX) ? maxX + 1 : 10, y: Number.isFinite(maxY) ? maxY + 1 : 10 }
    },
    outline: [{ id: 'o:1', points: [
      { x: Number.isFinite(minX) ? minX - 1 : 0, y: Number.isFinite(minY) ? minY - 1 : 0 },
      { x: Number.isFinite(maxX) ? maxX + 1 : 10, y: Number.isFinite(minY) ? minY - 1 : 0 },
      { x: Number.isFinite(maxX) ? maxX + 1 : 10, y: Number.isFinite(maxY) ? maxY + 1 : 10 },
      { x: Number.isFinite(minX) ? minX - 1 : 0, y: Number.isFinite(maxY) ? maxY + 1 : 10 },
      { x: Number.isFinite(minX) ? minX - 1 : 0, y: Number.isFinite(minY) ? minY - 1 : 0 }
    ], closed: true, layerId: 'Edge.Cuts' }],
    layers: [
      { id: 'F.Cu', name: 'F.Cu', kind: 'copper', side: 'F' },
      { id: 'B.Cu', name: 'B.Cu', kind: 'copper', side: 'B' },
      { id: 'F.SilkS', name: 'F.SilkS', kind: 'silk', side: 'F' },
      { id: 'Edge.Cuts', name: 'Edge.Cuts', kind: 'outline', side: null }
    ],
    copper: {
      'F.Cu': { traces: frontTraces, pads: [], vias: [], zones: [] },
      'B.Cu': { traces: backTraces, pads: [], vias: [], zones: [] }
    },
    silkscreen: { 'F.SilkS': { lines: [], arcs: [], texts } },
    footprints: [],
    drill: [],
    nets: [],
    stats: {
      traces: frontTraces.length + backTraces.length,
      pads: 0,
      vias: 0,
      zones: 0,
      texts: texts.length,
      drills: 0
    },
    warnings: []
  }
}
