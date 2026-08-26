import { describe, expect, it } from 'vitest'
import { boardModel } from '../../choreo/test/helpers.js'
import { summarize, toExportJob } from './api.js'

describe('studio board summary', () => {
  it('reports board layers and render acts', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const summary = summarize(board, 'ecc83-pp.kicad_pcb')

    expect(summary.fileName).toBe('ecc83-pp.kicad_pcb')
    expect(summary.layerCount).toBeGreaterThan(0)
    expect(summary.elementCount).toBeGreaterThan(0)
    expect(summary.acts).toEqual(expect.arrayContaining(['outline', 'drill', 'copper:F.Cu']))
  })
})

describe('studio export response mapping', () => {
  it('keeps the submitted id and exposes the advisory report', () => {
    const job = toExportJob('job-1', {
      status: 'done',
      progress: 100,
      metricsReport: {
        passed: false,
        rules: [{ rule: 'symmetry-phase', passed: false, detail: 'best mirror ratio 0.2' }]
      }
    })

    expect(job).toMatchObject({
      jobId: 'job-1',
      status: 'done',
      progress: 100,
      gatePassed: false,
      gateDetail: 'symmetry-phase: best mirror ratio 0.2'
    })
  })
})
