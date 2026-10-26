import type { ManufacturingData } from './manufacturing.js'

export type ProcessStage = readonly [number, string, string]
export interface Placement { side: 'top' | 'bottom'; mount: string; start: number; paste?: number; reflow?: number }
export function manufacturingPlan(data: ManufacturingData): { stages: ProcessStage[]; placements: Placement[]; finish: number; duration: number } {
  const copper = data.stack.filter(l => l.type === 'copper').length
  const stages: ProcessStage[] = [
    [0, '成品总览', data.title ?? 'PCB'], [3, '旋转拆解', `${copper} 层铜 / ${data.stack.length - copper} 层介质 · 源 CAD 装配`],
    [8, '真实叠层', '各层厚度直接读取 PCB 叠层'],
    [10, copper > 2 ? '内层蚀刻' : '双面覆铜基板', copper > 2 ? '整面铜箔 → 实际内层线路' : '源 PCB 未定义内铜层'],
    [14, '叠层与压合', '逐层对齐 · 源 PCB 介质与铜箔'],
    [20, '钻孔与孔金属化', '真实孔位与孔径 · 最终孔壁几何'], [23, '外层蚀刻', '形成顶层与底层铜线路'],
    [26, '阻焊', '源文件的实际阻焊开窗'], [29, '丝印', '原始标识与位号']
  ]
  const placements: Placement[] = []
  const refs = Object.values(data.nodes).filter(n => n.kind === 'component').map(n => n.ref ?? '')
  let cursor = 31
  for (const side of ['bottom', 'top'] as const) {
    const label = side === 'top' ? '顶面' : '底面'
    for (const mount of ['smd', 'through-hole', 'other']) {
      if (!refs.some(ref => data.footprints[ref]?.side === side && (data.footprints[ref].mount ?? 'smd') === mount)) continue
      if (mount === 'smd' && data.layers[side === 'top' ? 'F.Paste' : 'B.Paste']?.length) {
        placements.push({ side, mount, paste: cursor, start: cursor + 2, reflow: cursor + 5 })
        stages.push([cursor, `${label} · 锡膏印刷`, `${side === 'top' ? 'F' : 'B'}.Paste 原生绘图开口`],
          [cursor + 2, `${label} · SMT 贴装`, '原始器件模型按实际装配坐标落位'],
          [cursor + 5, `${label} · 回流焊`, '工艺光效示意 · 不推测焊点或温度场'])
        cursor += 7
      } else {
        placements.push({ side, mount, start: cursor })
        stages.push([cursor, `${label} · ${mount === 'through-hole' ? '通孔器件插装' : '器件装配'}`, '实际模型与坐标 · 不推测焊接工艺'])
        cursor += 3
      }
    }
  }
  stages.push([cursor, '装配完成', '回到未经改形的原始 STEP 装配'])
  return { stages, placements, finish: cursor, duration: cursor + 3 }
}
