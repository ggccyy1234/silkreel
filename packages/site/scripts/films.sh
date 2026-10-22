#!/bin/sh
# Renders the films the site measures or stills from, with silk reel itself, into packages/site/raw/.
# The formats table sizes come from the four StickHub files; the poster and og.png come from the iCEBreaker films.
# Run from the repo root: sh packages/site/scripts/films.sh
set -e
B=fixtures/boards
R=packages/site/raw
r() { out=$R/$1; shift; [ -f "$out" ] && { echo "skip $out"; return; }; echo "render $out"; npm run --silent reel -- "$@" -o "$out"; }
r glyph-StickHub-16x9.mp4 $B/StickHub.kicad_pcb --style glyph --aspect 16:9 --palette phosphor
r glyph-StickHub-16x9.gif $B/StickHub.kicad_pcb --style glyph --aspect 16:9 --palette phosphor --format gif
r glyph-StickHub-alpha-16x9.webm $B/StickHub.kicad_pcb --style glyph --aspect 16:9 --palette phosphor --format webm-alpha
r glyph-StickHub-16x9.mov $B/StickHub.kicad_pcb --style glyph --aspect 16:9 --palette phosphor --format prores-alpha
r glyph-icebreaker-16x9.mp4 $B/icebreaker.kicad_pcb --style glyph --aspect 16:9
r glyph-icebreaker-1x1.mp4 $B/icebreaker.kicad_pcb --style glyph --aspect 1:1
