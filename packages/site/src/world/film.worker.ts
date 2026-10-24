import { parseKicadPcb } from '@silk-reel/ingest'
import { ASPECT_SIZE, compileTimeline } from '@silk-reel/choreo'
import type { Aspect, GlyphTimeline } from '@silk-reel/choreo'

self.onmessage = (e: MessageEvent<{ text: string; name: string }>) => {
  try {
    const board = parseKicadPcb(e.data.text, e.data.name)
    const films = {} as Record<Aspect, GlyphTimeline>
    for (const aspect of Object.keys(ASPECT_SIZE) as Aspect[]) {
      films[aspect] = compileTimeline(board, {
        style: 'glyph', aspect, knobs: { tempo: 1, texts: 1 }, duration: 'auto', seed: 42,
        output: { ...ASPECT_SIZE[aspect], fps: 30 }
      } as never) as GlyphTimeline
    }
    const f = films['16:9']
    self.postMessage({
      ok: true,
      films,
      stats: { name: board.source.boardName || e.data.name, traces: board.stats.traces, pads: board.stats.pads, vias: board.stats.vias, layers: Object.keys(board.copper).length, glyphs: f.placements.length, footprints: board.footprints.length }
    })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
