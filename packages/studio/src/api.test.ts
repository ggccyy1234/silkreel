import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardModel } from '../../choreo/test/helpers.js'
import { moveAct, pollJob, summarize, toExportJob } from './api.js'

describe('studio board summary', () => {
  it('reports board layers and render acts', () => {
    const board = boardModel('ecc83-pp.kicad_pcb')
    const summary = summarize(board, 'ecc83-pp.kicad_pcb')

    expect(summary.fileName).toBe('ecc83-pp.kicad_pcb')
    expect(summary.layerCount).toBeGreaterThan(0)
    expect(summary.elementCount).toBeGreaterThan(0)
    expect(summary.layerNames).toEqual(expect.arrayContaining(['F.Cu', 'F.SilkS']))
    expect(summary.footprintCount).toBe(board.footprints.length)
    expect(summary.padCount).toBeGreaterThan(0)
    expect(summary.traceCount).toBeGreaterThan(0)
    expect(summary.silkMarkCount).toBeGreaterThan(0)
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

describe('studio act priority movement', () => {
  it('moves an act to a new priority without mutating the current order', () => {
    const order = ['outline', 'drill', 'copper:F.Cu'] as const

    expect(moveAct([...order], 2, 0)).toEqual(['copper:F.Cu', 'outline', 'drill'])
    expect(order).toEqual(['outline', 'drill', 'copper:F.Cu'])
  })
})

describe('studio job polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stops after the configured number of attempts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ status: 'pending', progress: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })))
    vi.stubGlobal('fetch', fetchMock)
    const polling = pollJob('job-1', { intervalMs: 10, maxAttempts: 2 })
    const assertion = expect(polling).rejects.toThrow('job polling timed out')

    await vi.advanceTimersByTimeAsync(30)

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects with an abort error while waiting for the next attempt', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status: 'rendering', progress: 10 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const polling = pollJob('job-1', { intervalMs: 1000, maxAttempts: 2, signal: controller.signal })
    const assertion = expect(polling).rejects.toMatchObject({ name: 'AbortError' })

    await vi.advanceTimersByTimeAsync(1000)
    controller.abort()

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
