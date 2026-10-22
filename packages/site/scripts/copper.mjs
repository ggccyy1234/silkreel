// Writes public/img/icebreaker-cu.svg (render it to icebreaker-cu.webp at 2000 px wide, then delete the svg): the iCEBreaker's real top copper (from figure/board.json) for the countdown leader
import { readFileSync, writeFileSync } from 'node:fs'
const B = JSON.parse(readFileSync(new URL('../figure/board.json', import.meta.url), 'utf8'))
const { min, max } = B.bbox
const r = (n) => Math.round(n * 100) / 100
const pt = ([x, y]) => `${r(x - min.x)} ${r(y - min.y)}`
const pad = (p) => {
  const c = Math.cos((p.rot * Math.PI) / 180), s = Math.sin((p.rot * Math.PI) / 180), hw = p.w / 2, hh = p.h / 2
  return 'M' + [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => pt([p.x + a * c - b * s, p.y + a * s + b * c])).join('L') + 'Z'
}
const byWidth = new Map()
for (const t of B.traces) { const k = r(t.w); byWidth.set(k, (byWidth.get(k) ?? '') + 'M' + t.p.map(pt).join('L')) }
const traces = [...byWidth].map(([w, d]) => `<path d="${d}" stroke-width="${w}"/>`).join('')
const pads = B.pads.filter((p) => p.ref !== 'U4').map(pad).join('')
const hero = B.pads.filter((p) => p.ref === 'U4').map(pad).join('')
const vias = B.vias.map(([x, y, d]) => `M${r(x - min.x - d / 2)} ${r(y - min.y)}a${r(d / 2)} ${r(d / 2)} 0 1 0 ${r(d)} 0a${r(d / 2)} ${r(d / 2)} 0 1 0 ${-r(d)} 0`).join('')
const edges = B.outline.map((o) => 'M' + o.map(pt).join('L')).join('')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(max.x - min.x)} ${r(max.y - min.y)}"><g fill="none" stroke="#c98a5a" stroke-linecap="round" stroke-linejoin="round">${traces}</g><path d="${edges}" fill="none" stroke="#6b5444" stroke-width=".15"/><path d="${pads}" fill="#e7b48a"/><path d="${vias}" fill="#e7b48a"/><path d="${hero}" fill="#ff4a3d"/></svg>`
writeFileSync(new URL('../public/img/icebreaker-cu.svg', import.meta.url), svg)
console.log((svg.length / 1024).toFixed(0), 'KB')
