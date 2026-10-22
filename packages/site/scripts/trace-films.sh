#!/bin/sh
# Renders the trace films the site plays into packages/site/public/films/trace/ (gitignored, about 63 MB).
# Each board gets <board>-540.mp4 (16:9), <board>-9x16|1x1|4x5.mp4 and a matching -poster.webp; icebreaker also gets -720.mp4 for the looks section.
# Run from the repo root: sh packages/site/scripts/trace-films.sh. A full set takes about an hour on a laptop GPU.
set -e
out=packages/site/public/films/trace
tmp=$(mktemp -d)
mkdir -p "$out"
for b in icebreaker glasgow StickHub ecc83-pp kit-dev-coldfire-xilinx_5213; do
  for a in 16:9 9:16 1:1 4:5; do
    t=$(echo "$a" | tr : x)
    SILK_REEL_CONCURRENCY=4 npm run reel -- "fixtures/boards/$b.kicad_pcb" --style trace --aspect "$a" --no-audio -o "$tmp/$b-$t.mp4"
    name=$b-$t; tag=-$t
    if [ "$t" = 16x9 ]; then name=$b-540; tag=; fi
    ffmpeg -v error -y -i "$tmp/$b-$t.mp4" -vf "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'" -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an "$out/$name.mp4"
    ffmpeg -v error -y -ss 10.5 -i "$out/$name.mp4" -frames:v 1 "$tmp/poster.png"
    python3 -c "from PIL import Image; Image.open('$tmp/poster.png').convert('RGB').save('$out/$b$tag-poster.webp', 'WEBP', quality=82, method=6)"
  done
done
cp "$out/icebreaker-540.mp4" "$out/icebreaker-720.mp4"
rm -rf "$tmp"
