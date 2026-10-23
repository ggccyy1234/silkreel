// Writes public/films/icebreaker-routes.json for the countdown: the iCEBreaker's top copper traces in 1/20 mm, sorted outward from U4
import { readFileSync, writeFileSync } from 'node:fs'
const B = JSON.parse(readFileSync(new URL('../figure/board.json', import.meta.url), 'utf8'))
const { min, max } = B.bbox
const q = (v) => Math.round(v * 20)
const u4 = B.parts.find((p) => p.ref === 'U4')
const at = [u4.x - min.x, u4.y - min.y]
const dist = (t) => Math.min(...t.p.map(([x, y]) => Math.hypot(x - min.x - at[0], y - min.y - at[1])))
const traces = [...B.traces].sort((a, b) => dist(a) - dist(b)).map((t) => [q(t.w), ...t.p.flatMap(([x, y]) => [q(x - min.x), q(y - min.y)])])
writeFileSync(new URL('../public/films/icebreaker-routes.json', import.meta.url), JSON.stringify({ w: q(max.x - min.x), h: q(max.y - min.y), u4: at.map(q), t: traces }))
