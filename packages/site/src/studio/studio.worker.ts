import { parseKicadPcb } from '@silk-reel/ingest'
import type { BoardModel } from '@silk-reel/ingest'
import { compileTimeline } from '@silk-reel/choreo'
import type { FilmConfig } from '@silk-reel/choreo'

export type ToWorker =
  | { type: 'load'; id: string; text: string; name: string }
  | { type: 'compile'; req: number; id: string; config: FilmConfig }
  | { type: 'board'; req: number; id: string }

export interface BoardStats { name: string }

export type FromWorker =
  | { type: 'loaded'; id: string; stats: BoardStats }
  | { type: 'timeline'; req: number; timeline: ReturnType<typeof compileTimeline>; ms: number }
  | { type: 'board'; req: number; board: BoardModel }
  | { type: 'error'; id: string; req?: number; error: string }

const boards = new Map<string, BoardModel>()
const post = (m: FromWorker) => { self.postMessage(m) }

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      const board = parseKicadPcb(m.text, m.name)
      if (!board.footprints.length && !board.stats.traces) throw new Error('it holds no parts or traces')
      boards.set(m.id, board)
      post({ type: 'loaded', id: m.id, stats: { name: board.source.boardName || m.name } })
      return
    }
    const board = boards.get(m.id)
    if (!board) throw new Error(`board ${m.id} is not loaded`)
    if (m.type === 'compile') {
      const t0 = performance.now()
      const timeline = compileTimeline(board, m.config)
      post({ type: 'timeline', req: m.req, timeline, ms: performance.now() - t0 })
    } else post({ type: 'board', req: m.req, board })
  } catch (err) {
    post({ type: 'error', id: m.id, ...('req' in m ? { req: m.req } : {}), error: err instanceof Error ? err.message : String(err) })
  }
}
