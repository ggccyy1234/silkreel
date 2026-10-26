# Changelog

## v0.2.0-cad.1 — 2026-10-26

- Made KiCad 10 installation an explicit hard requirement and added cross-machine Agent discovery requirements for KiCad, pcbnew, model libraries and path overrides.
- Added a portable JLC3D interface for exact LCSC model lookup/download, local downloader/config discovery, STEP validation, source hashes and download reports.
- JLC lookup now accepts exact PCB component model numbers (MPN) as well as LCSC codes and stops on ambiguous package variants.
- Per-board outputs now default to a dedicated `<board>-silkreel/` directory beside the read-only source PCB.
- Documented exact model repair for missing and undeclared footprint models while forbidding symbol-library and global shared-footprint mutation; unverifiable placement still stops.
- Added unified environment inspection/bootstrap and per-board automatic output directories.
- Added end-to-end automatic model repair with project-local PCB staging, JLC placement transforms, model maps, source provenance and offline cache.
- Clarified that the public GitHub fork remains Apache-2.0, added CAD package license/repository metadata, and documented that npm `private: true` prevents accidental publishing without changing open-source licensing.

## v0.1.0-cad.1 — 2026-10-26

First Windows x64 prerelease of the source-faithful CAD renderer, independent of the upstream inferred trace/glyph component rendering.

- Native KiCad model-reference audit, explicit path mapping, immutable input snapshots and hashes; missing visible files stop the job.
- KiCad native VRML assembly rendering and OpenCascade STEP/XCAF conversion with assembly locations, CAD colors and per-face triangulation checks.
- Local interactive Three.js viewer, PNG/GLB and H.264 MP4 output.
- Explicit KiCad transparent laminate/mask/silkscreen ordering keeps front-side markings visible while rotating, without changing source opacity or geometry.
- One-command native PCB → STEP → exploded manufacturing film, qualified for ordinary 4/6 copper-layer boards with explicit stackup and through vias.
- Native copper/drill contours and native paste SVG plots; source component attributes determine top/bottom SMT and through-hole insertion chapters.
- Unqualified stackups, blind/buried vias, missing STEP components and unsupported model geometry stop instead of generating replacements. Explicit disclosed partial rendering is available only for existing STEP companions.
- Per-output-frame browser/visible-geometry/viewport checks, complete frame decoding, optional export of every PNG, 5 fps contact sheets, stage capture and endpoint/seek restoration checks.
- Root README requires agent-assisted input assessment, compatibility handling and evidence-backed visual review. Runtime needs no LLM or API key.
- Reproducible compact CLI ZIP build with pinned npm dependency lock and SHA-256; external CAD libraries and user boards are excluded.

Known limits: Windows x64 + KiCad 10 tested. 2-layer and 8+ layer manufacturing, nonalternating/multimaterial stackups, HDI and rigid-flex are not qualified. WRL references cannot be silently substituted for STEP. Process motion, display paste thickness and reflow light are illustrative, not fabrication, thermal or solder-joint simulation. Legacy upstream tests include known platform-dependent failures and are reported separately from the CAD release gate.
