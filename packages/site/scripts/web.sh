#!/bin/sh
# The page draws every film live from public/films/glyph/*.json (scripts/timelines.mts).
# The one bitmap it ships is the no-JavaScript poster, taken from a raw/ render (scripts/films.sh).
# Run from packages/site: sh scripts/web.sh
set -e
mkdir -p public/films
ffmpeg -loglevel error -y -ss 7.4 -i raw/glyph-icebreaker-16x9.mp4 -frames:v 1 -vf "scale=1280:-2:flags=lanczos" -q:v 3 public/films/poster-glyph-16x9.jpg
