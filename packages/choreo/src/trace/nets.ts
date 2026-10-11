import type { Net } from '@silk-reel/ingest'

/**
 * What a net does, read off its name. KiCad files rarely carry net classes,
 * but designers name nets by role: GND, +3V3, CLKIF, USB_P/USB_N, D0..D7.
 * That's enough to cast the growth: clocks tick, buses move in lockstep,
 * pairs travel together, power floods.
 */
export type NetKind = 'ground' | 'power' | 'clock' | 'diff' | 'bus' | 'signal'

export interface NetGroup {
  key: string
  kind: NetKind
  netIds: number[]
}

/** last hierarchical segment, inversion markup stripped: "/buspci.sch/EA1" → "EA1", "/~{RESET}" → "RESET" */
export function bareName(name: string): string {
  const last = name.split('/').filter((s) => s.length > 0).at(-1) ?? name
  return last.replace(/~\{([^}]*)\}/g, '$1').replace(/^~/, '')
}

const AUTO = /^(Net-\(|unconnected-|net\d+$)/i

export function netKind(name: string): NetKind {
  const n = bareName(name)
  if (/^(A|D|P)?GND|^VSS|^0V$|GND$/i.test(n)) return 'ground'
  if (/^\+|^V(CC|DD|BUS|IN|BAT|USB|AA|PLL|REF)|^\d+V\d*$|^\d+V\d*[A-Z]?$|^PWR/i.test(n)) return 'power'
  if (/CLK|XTAL|OSC|SCK$|^SCK|MCLK|BCLK/i.test(n)) return 'clock'
  return 'signal'
}

const PARTNER: Record<string, string> = { _P: '_N', _N: '_P', '+': '-', '-': '+', _H: '_L', _L: '_H', P: 'N', N: 'P' }

/**
 * Nets grouped into casting units: a bus (≥3 nets sharing a prefix and
 * differing only in a trailing index) moves as one, a differential pair moves
 * as one, everything else is its own unit.
 */
export function groupNets(nets: Net[]): { groups: NetGroup[]; groupOf: Map<number, number> } {
  const named = nets.filter((n) => n.id > 0 && !AUTO.test(bareName(n.name)) && !/^unconnected/i.test(n.name))
  const byName = new Map(named.map((n) => [bareName(n.name), n]))
  const groups: NetGroup[] = []
  const groupOf = new Map<number, number>()
  const add = (key: string, kind: NetKind, ids: number[]): void => {
    groups.push({ key, kind, netIds: ids })
    for (const id of ids) groupOf.set(id, groups.length - 1)
  }

  // pairs: both halves must exist, and power names (+5V / -5V) never pair
  for (const n of named) {
    if (groupOf.has(n.id)) continue
    const bare = bareName(n.name)
    const kind = netKind(n.name)
    if (kind === 'power' || kind === 'ground') continue
    const m = /^(.*?)(_P|_N|\+|-|_H|_L|P|N)$/.exec(bare)
    if (m === null || (m[1] ?? '').length === 0) continue
    const other = byName.get(`${m[1]}${PARTNER[m[2] as string]}`)
    if (other === undefined || groupOf.has(other.id)) continue
    add(`diff:${m[1]}`, 'diff', [n.id, other.id])
  }

  // buses: trailing index under a shared prefix, at least 3 members
  const buses = new Map<string, number[]>()
  for (const n of named) {
    if (groupOf.has(n.id)) continue
    const kind = netKind(n.name)
    if (kind !== 'signal') continue
    const m = /^(.*?[A-Za-z_])(\d+)$/.exec(bareName(n.name))
    if (m === null) continue
    const prefix = m[1] as string
    const list = buses.get(prefix) ?? []
    list.push(n.id)
    buses.set(prefix, list)
  }
  for (const [prefix, ids] of buses) if (ids.length >= 3) add(`bus:${prefix}`, 'bus', ids)

  for (const n of nets) {
    if (n.id <= 0 || groupOf.has(n.id)) continue
    add(`net:${n.id}`, netKind(n.name), [n.id])
  }
  return { groups, groupOf }
}
