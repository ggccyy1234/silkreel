# silk reel

**KiCad board in, release video out.** silk reel turns a `.kicad_pcb` into a post-ready PCB release film built from the board's real geometry: copper growing out from the hero chip, pads popping as the wavefront reaches them, then zones, silkscreen, and a title card.

| Trace Growth | Glyph Loop |
|---|---|
| ![Trace Growth on iCEBreaker](docs/media/icebreaker-trace.gif) | ![Glyph Loop on iCEBreaker](docs/media/icebreaker-glyph.gif) |

## Quick start

```bash
npm install

# CLI
npm run reel -- path/to/board.kicad_pcb --aspect 9:16 --title "iCEBreaker" --version v1.0e -o ice.mp4

# Studio (live preview + export)
npm run start --workspace=@silk-reel/render-api   # render API on :3102
npm run dev --workspace=@silk-reel/studio         # studio on :3101
```

Requires Node 22+ and `ffmpeg`/`ffprobe` on the PATH. Remotion downloads its headless Chromium on first render.

## Options

| flag | values | default |
|---|---|---|
| `--style` | `trace` (copper grows from the hero footprint), `glyph` (footprint glyphs in mirrored formations) | `trace` |
| `--aspect` | `4:5` 1080×1350 · `1:1` 1080×1080 · `9:16` 1080×1920 · `16:9` 1920×1080 | `4:5` |
| `--palette` | `copper` · `mono` · `blueprint` · `phosphor` | `copper` (trace), `mono` (glyph) |
| `--accent` | `#rrggbb` for growth heads / glyph hero | palette head |
| `--title`, `--version` | title card text; omit for no card | none |
| `--format` | `mp4` · `gif` (≤720px) · `webm-alpha` · `prores-alpha` (4444) | `mp4` |
| `--seed`, `--tempo` (0.75–1.5), `--density` (0.5–1.5) | variation and pacing | `42`, `1`, `1` |
| `-o` | output path | `<board>-<style>-<aspect>.<ext>` next to the input |

The alpha formats render with a transparent background, ready to drop over your own footage. Renders are deterministic for a given board and config.

## How it works

`ingest` parses the board into a `BoardModel`. `choreo` compiles it into a timeline: for Trace Growth, it picks a hero footprint, builds a copper connectivity graph across layers (vias and through-hole pads bridge them), and schedules growth outward from the hero. `render` draws each frame with Canvas2D, and a WebGL2 pass adds bloom, vignette, and grain. Remotion drives the studio preview and the final encode.

See [AGENTS.md](AGENTS.md) for development commands and the full-video review gate every visual change goes through.

## Font

Title cards use bundled JetBrains Mono (`packages/render/src/assets/`, SIL Open Font License 1.1, see `OFL.txt`) so renders are identical on every machine.
