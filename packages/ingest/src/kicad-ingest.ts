import { parseSExpr } from './sexp.js'
import { head } from './sexp-query.js'
import { classifyKicad } from './kicad.js'
import type { BoardModel } from './types.js'
import { ParseError } from './errors.js'

export function parseKicadPcb(contents: string, fileName = 'board.kicad_pcb'): BoardModel {
  if (looksLikeBinary(contents)) {
    throw new ParseError(fileName, 'file appears to be binary, not a KiCad s-expression document')
  }
  const root = parseSExpr(contents, fileName)
  if (head(root) !== 'kicad_pcb') {
    throw new ParseError(fileName, `expected a (kicad_pcb ...) document, found (${head(root)} ...)`)
  }
  return classifyKicad(root, fileName)
}

function looksLikeBinary(text: string): boolean {
  const sample = text.slice(0, 4096)
  let suspicious = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    if (code === 0 || (code < 9 && code > 0) || (code > 13 && code < 32 && code !== 27)) suspicious += 1
  }
  return suspicious > sample.length * 0.05
}
