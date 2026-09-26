# silk-reel agent guide

KiCad board in, release video out. TypeScript monorepo (npm workspaces):

| package | role |
|---|---|
| `packages/ingest` | `.kicad_pcb` parser → `BoardModel` |
| `packages/choreo` | style engine: `compileTimeline(board, FilmConfig)` → `Timeline` (`trace` scene or `glyph` tracks), palettes, aspect layout, cast hints |
| `packages/render` | Canvas2D frame drawing (`drawFrame`) + WebGL2 bloom post pass + Remotion composition |
| `packages/render-api` | Fastify API, serial render queue, `renderFilm()` (mp4/gif/webm-alpha/prores-alpha) |
| `packages/studio` | Vite + Remotion Player web studio |
| `packages/cli` | `npm run reel -- board.kicad_pcb [flags]` |
| `packages/metrics` | ffmpeg-based probes and the advisory numeric gate |

## Commands

- `npx tsc --noEmit` (typecheck), `npx vitest run [path]` (tests), `npx eslint packages` (lint)
- `npm run test:production`: builds the studio and smoke-tests it against a fake render API
- `npm run reel -- fixtures/boards/icebreaker.kicad_pcb --aspect 9:16 --title iCEBreaker --version v1.0e -o /tmp/ice.mp4`
- `npx tsx scripts/format-smoke.mts`: renders glasgow in all four formats to `/tmp/fmt` and prints ffprobe facts
- Studio: `npm run start --workspace=@silk-reel/render-api` (port 3102) and `npm run dev --workspace=@silk-reel/studio` (port 3101)

## Env vars

- `SILK_REEL_GL`: Chromium GL backend for renders (default `angle`, which uses the GPU; use `swangle` on GPU-less CI/servers)
- `SILK_REEL_CONCURRENCY`: Remotion frame concurrency (default: half the cores)

## The review gate: tests prove structure, not beauty

Deterministic tests pass on videos that look like slop. A change to anything visual is done only after a full-video review:

1. `npm run review -- --styles trace,glyph --boards all --aspects 4:5,1:1,9:16,16:9` writes `review/<stamp>/` (videos, 5 fps contact sheets covering every second, `index.html`, and a `notes.md` template). `npx tsx scripts/review-stats.mts review/<stamp>` adds numeric evidence (dead air, coverage, clipping).
2. Open **every** sheet for every video and watch each loop at real speed. Spot-checking a few frames is not a review.
3. Record PASS/FAIL with one concrete sentence per rubric line per video:
   Hook (something within 0.5s) · Flow (no stalls, pops, or jitter) · Legibility at phone size · Board identity · Composition (70–85% of the safe area, re-laid out per aspect) · Arc (build → climax → hold ≥1.5s → resolve) · Loop seam · Color/glow (no washout) · Would you post it?
4. Any FAIL or "no" means iterate. Commit the notes under `docs/reviews/`.

## Gotchas

- Imports inside `packages/render` must not carry `.js` extensions (the Remotion bundler resolves `.ts`/`.tsx` directly).
- The post pass renders on its own WebGL canvas and returns it; the visible canvas stays 2d so the fallback path works when WebGL2 or shader compilation fails.
- Alpha formats need `transparent: true`; the queue and CLI set it automatically. GIFs render without grain and at ≤720px wide (`renderFilm` does both).
- Never pixel-hash post-processed frames in tests. GPU output differs across machines, so test the 2D draw through `test-recorder.ts`.
- `fixtures/reference/pcbanimation.mp4` is another artist's work. Keep it as a private comparison only; never ship it.
