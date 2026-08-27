import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultActOrder } from '@silk-reel/choreo'
import type { ActId } from '@silk-reel/choreo'
import type { BoardModel } from '@silk-reel/ingest'

export interface BoardSummary {
  board: BoardModel
  fileName: string
  layerCount: number
  elementCount: number
  acts: ActId[]
}

const API = ''

export function useBoardSources() {
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const loadDemo = useCallback(async (demoId: string): Promise<BoardModel | undefined> => {
    setLoadingDemo(demoId)
    setError(null)
    try {
      const res = await fetch(`${API}/api/demo/${encodeURIComponent(demoId)}`)
      if (!res.ok) throw new Error(`demo board ${demoId} failed to load (${res.status})`)
      return (await res.json()) as BoardModel
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    } finally {
      setLoadingDemo(null)
    }
  }, [])

  const parseFile = useCallback(async (file: File): Promise<BoardModel | undefined> => {
    setError(null)
    try {
      if (/\.(kicad_pcb|kicad_mod)$/i.test(file.name)) {
        const text = await file.text()
        const res = await fetch(`${API}/api/parse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'kicad', fileName: file.name, contents: text })
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `parse failed (${res.status})`)
        }
        return (await res.json()) as BoardModel
      }
      if (/\.(gtl|gbl|gml|gko|drl|drd|cmp|sol|gpi)$/i.test(file.name)) {
        throw new Error('gerber sets land in m4; drop a .kicad_pcb for now')
      }
      throw new Error('unsupported file; drop a .kicad_pcb')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return undefined
    }
  }, [])

  return { loadingDemo, error, loadDemo, parseFile, clearError }
}

export function summarize(board: BoardModel, fileName: string): BoardSummary {
  const copperLayers = Object.keys(board.copper)
  const silkLayers = Object.keys(board.silkscreen)
  let elements = board.outline.length + board.drill.length
  for (const c of Object.values(board.copper)) {
    elements += c.traces.length + c.pads.length + c.vias.length + c.zones.length
  }
  for (const s of Object.values(board.silkscreen)) {
    elements += s.lines.length + s.texts.length + s.arcs.length
  }
  const acts = defaultActOrder(board)
  return { board, fileName, layerCount: copperLayers.length + silkLayers.length, elementCount: elements, acts }
}

export function presentationActOrder(acts: ActId[]): ActId[] {
  const copper = acts.filter((id) => id.startsWith('copper:'))
  const frontCopper = copper.filter((id) => id === 'copper:F.Cu')
  const otherCopper = copper.filter((id) => id !== 'copper:F.Cu')
  const silk = acts.filter((id) => id.startsWith('silk:'))
  const structural = acts.filter((id) => id === 'drill' || id === 'outline')
  return [...frontCopper, ...silk, ...structural, ...otherCopper]
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, delayMs: number): (...args: A) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => () => {
    clearTimeout(timer.current)
  }, [])
  return useCallback(
    (...args: A) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fnRef.current(...args)
      }, delayMs)
    },
    [delayMs]
  )
}

interface JobResponse {
  jobId: string
}

interface MetricsResponse {
  passed: boolean
  rules: Array<{ rule: string; passed: boolean; detail: string }>
}

interface RenderJobResponse {
  status: JobPhase
  progress: number
  error?: string
  metricsReport?: MetricsResponse
  metricsError?: string
}

export type JobPhase = 'pending' | 'rendering' | 'done' | 'error'

export interface ExportJob {
  jobId: string
  status: JobPhase
  progress: number
  gatePassed: boolean | null
  gateDetail: string | null
  error: string | null
}

export function toExportJob(jobId: string, response: RenderJobResponse): ExportJob {
  return {
    jobId,
    status: response.status,
    progress: response.progress,
    gatePassed: response.metricsReport?.passed ?? null,
    gateDetail: response.metricsReport?.rules.map((rule) => `${rule.rule}: ${rule.detail}`).join(' · ') ?? response.metricsError ?? null,
    error: response.error ?? null
  }
}

export async function submitExport(payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `export rejected (${res.status})`)
  }
  const body = (await res.json()) as JobResponse
  return body.jobId
}

export async function pollJob(jobId: string): Promise<ExportJob> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const res = await fetch(`${API}/api/job/${jobId}`)
    if (!res.ok) throw new Error(`job poll failed (${res.status})`)
    const response = (await res.json()) as RenderJobResponse
    const job = toExportJob(jobId, response)
    if (job.status === 'done' || job.status === 'error') return job
  }
}

export function downloadUrl(jobId: string): string {
  return `${API}/api/download/${jobId}`
}
