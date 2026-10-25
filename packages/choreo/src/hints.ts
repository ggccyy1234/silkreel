import type { CastHints } from './types'

/** per-board cast curation for the bundled fixtures — the art director's pick of hero footprints/labels, keyed by board name */
export const DEMO_CAST_HINTS: Readonly<Record<string, CastHints>> = {
  icebreaker: {
    preferRefs: ['P1', 'SW1', 'SW2', 'SW3', 'SW4', 'J31', 'J33', 'J34', 'U4', 'U5', 'U6'],
    preferTexts: ['iCEBreaker', 'V1.0e', 'FPGA', 'FLASH', 'PMOD1A', 'PMOD1B', 'RGBLED']
  },
  glasgow: {
    preferRefs: ['J4', 'J2', 'J3', 'J1', 'J5', 'J10', 'U1', 'SW1'],
    preferTexts: ['ADC A', 'ADC B', 'AUX', 'ACT', '5V', '3V3', '1V2', 'LVDS']
  }
}
