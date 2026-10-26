import type { StackLayer } from './manufacturing.js'

/** Release qualification is narrower than the parser's possible input range. */
export function requireQualifiedStack(stack: StackLayer[]): void {
  const copper = stack.filter(l => l.type === 'copper')
  if (![4, 6].includes(copper.length)) throw new Error(`Manufacturing release supports qualified 4/6 copper-layer boards only; got ${copper.length}. Ask an agent to adapt and validate the timeline/layout first. Use render without --pcb for an assembled view.`)
  const expected = ['F.Cu', ...Array.from({ length: copper.length - 2 }, (_, i) => `In${i + 1}.Cu`), 'B.Cu']
  if (stack.length !== copper.length * 2 - 1 || stack.some((l, i) => !Number.isFinite(l.thickness) || l.thickness <= 0
    || (i % 2 === 0 ? l.type !== 'copper' || l.name !== expected[i / 2] : !['core', 'prepreg'].includes(l.type)))) {
    throw new Error('Unsupported stackup: require ordered F.Cu / dielectric / InN.Cu / dielectric / B.Cu with explicit finite positive thicknesses. No layers were inferred or merged.')
  }
}
