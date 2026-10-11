import { describe, expect, it } from 'vitest'
import type { Net } from '@silk-reel/ingest'
import { bareName, groupNets, netKind } from './nets'
import { boardModel } from '../../test/helpers'

const nets = (names: string[]): Net[] => names.map((name, i) => ({ id: i + 1, name, nodeRefs: [] }))

describe('netKind', () => {
  it('reads roles off net names', () => {
    expect(netKind('GND')).toBe('ground')
    expect(netKind('/AGND')).toBe('ground')
    expect(netKind('+3V3')).toBe('power')
    expect(netKind('VBUS')).toBe('power')
    expect(netKind('/CLKIF')).toBe('clock')
    expect(netKind('/XTALIN')).toBe('clock')
    expect(netKind('/USB_P')).toBe('signal')
    expect(netKind('Net-(R6-Pad1)')).toBe('signal')
  })

  it('strips hierarchy and inversion markup', () => {
    expect(bareName('/buspci.sch/EA1')).toBe('EA1')
    expect(bareName('/~{CY_RESET}')).toBe('CY_RESET')
  })
})

describe('groupNets', () => {
  it('pairs differential halves, gathers indexed buses, leaves the rest alone', () => {
    const { groups, groupOf } = groupNets(nets(['/USB_P', '/USB_N', '/D0', '/D1', '/D2', '/A0', '/A1', '+5V', '-5V', 'GND', 'Net-(C1-Pad1)']))
    const byKey = new Map(groups.map((g) => [g.key, g]))
    expect(byKey.get('diff:USB')?.netIds).toEqual([1, 2])
    expect(byKey.get('bus:D')?.netIds).toEqual([3, 4, 5])
    // two members is not a bus
    expect(byKey.has('bus:A')).toBe(false)
    // power rails never pair as +/-
    expect(groups.find((g) => g.kind === 'diff' && g.netIds.includes(8))).toBeUndefined()
    // every positive net lands in exactly one group
    for (let id = 1; id <= 11; id++) expect(groupOf.has(id)).toBe(true)
  })

  it('casts glasgow: the USB pair and its byte-wide buses', () => {
    const { groups } = groupNets(boardModel('glasgow.kicad_pcb').nets)
    expect(groups.some((g) => g.key === 'diff:USB')).toBe(true)
    expect(groups.find((g) => g.key === 'bus:D')?.netIds.length).toBe(8)
    expect(groups.filter((g) => g.kind === 'clock').length).toBeGreaterThan(0)
  })
})
