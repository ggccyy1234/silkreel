import path from 'node:path'
import { rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { GateReport } from './gate.js'
import type { RenderFilmOptions, RenderFilmResult } from './render-film.js'
import { RenderQueue } from './queue.js'
import type { RenderJob } from './queue.js'

const outputPaths = new Set<string>()

afterEach(async () => {
  await Promise.all([...outputPaths].map((outputPath) => rm(outputPath, { force: true })))
  outputPaths.clear()
})

function gateReport(file: string, passed: boolean): GateReport {
  return {
    file,
    passed,
    facts: {
      width: 1080,
      height: 1350,
      fps: 15,
      durationSeconds: 167 / 15,
      frameCount: 167,
      codec: 'h264',
      pixFmt: 'yuv420p'
    },
    rules: []
  }
}

function doneJob(queue: RenderQueue, id: string): Extract<RenderJob, { status: 'done' }> {
  const job = queue.get(id)
  expect(job?.status).toBe('done')
  if (job === undefined || job.status !== 'done') throw new Error(`job ${id} did not finish successfully`)
  return job
}

describe('render queue execution', () => {
  it('runs FIFO with no overlap, reuses the bundle, and preserves downloads across gate outcomes', async () => {
    const events: string[] = []
    const bundleLocations: string[] = []
    let active = 0
    let maxActive = 0
    let bundleCalls = 0
    let gateCalls = 0
    const render = async (options: RenderFilmOptions): Promise<RenderFilmResult> => {
      const jobId = path.basename(options.outputLocation, '.mp4')
      expect(active).toBe(0)
      active += 1
      maxActive = Math.max(maxActive, active)
      events.push(`start:${jobId}`)
      outputPaths.add(options.outputLocation)
      bundleLocations.push(options.bundleLocationOverride ?? '')
      try {
        options.onProgress?.(40)
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        await writeFile(options.outputLocation, 'test video')
      } finally {
        active -= 1
        events.push(`finish:${jobId}`)
      }
      return { bundleLocation: options.bundleLocationOverride ?? '', outputLocation: options.outputLocation }
    }
    const runGate = (videoPath: string): Promise<GateReport> => {
      gateCalls += 1
      if (gateCalls === 3) return Promise.reject(new Error('metrics unavailable'))
      return Promise.resolve(gateReport(videoPath, gateCalls === 1))
    }
    const queue = new RenderQueue({
      renderFilm: render,
      runGate,
      bundle: () => {
        bundleCalls += 1
        return Promise.resolve('test-bundle')
      }
    })

    await queue.prepare()

    const first = queue.submit({ demoId: 'ecc83-pp' })
    const second = queue.submit({ demoId: 'ecc83-pp' })
    const third = queue.submit({ demoId: 'ecc83-pp' })
    const ids = [first.id, second.id, third.id]
    await queue.waitForIdle()

    expect(events).toEqual([
      `start:${first.id}`,
      `finish:${first.id}`,
      `start:${second.id}`,
      `finish:${second.id}`,
      `start:${third.id}`,
      `finish:${third.id}`
    ])
    expect(maxActive).toBe(1)
    expect(bundleCalls).toBe(1)
    expect(bundleLocations).toEqual(['test-bundle', 'test-bundle', 'test-bundle'])

    const completed = ids.map((id) => doneJob(queue, id))
    expect(completed.map((job) => job.gate.status)).toEqual(['passed', 'failed', 'unavailable'])
    expect(completed.map((job) => job.downloadPath)).toEqual([...outputPaths])
    expect(completed.every((job) => job.progress === 100)).toBe(true)
  })

  it('serializes rendering across queue instances', async () => {
    const events: string[] = []
    let active = 0
    const render = async (options: RenderFilmOptions): Promise<RenderFilmResult> => {
      const jobId = path.basename(options.outputLocation, '.mp4')
      expect(active).toBe(0)
      active += 1
      events.push(`start:${jobId}`)
      outputPaths.add(options.outputLocation)
      await new Promise<void>((resolve) => setTimeout(resolve, 2))
      await writeFile(options.outputLocation, 'test video')
      active -= 1
      events.push(`finish:${jobId}`)
      return { bundleLocation: 'test-bundle', outputLocation: options.outputLocation }
    }
    const options = {
      renderFilm: render,
      runGate: (videoPath: string) => Promise.resolve(gateReport(videoPath, true)),
      bundle: () => Promise.resolve('test-bundle')
    }
    const firstQueue = new RenderQueue(options)
    const secondQueue = new RenderQueue(options)
    const first = firstQueue.submit({ demoId: 'ecc83-pp' })
    const second = secondQueue.submit({ demoId: 'ecc83-pp' })

    await Promise.all([firstQueue.waitForIdle(), secondQueue.waitForIdle()])

    expect(events).toEqual([`start:${first.id}`, `finish:${first.id}`, `start:${second.id}`, `finish:${second.id}`])
  })

  it('keeps reported progress finite, bounded, and monotonic', async () => {
    const observed: number[] = []
    const render = async (options: RenderFilmOptions): Promise<RenderFilmResult> => {
      const id = path.basename(options.outputLocation, '.mp4')
      outputPaths.add(options.outputLocation)
      for (const progress of [50, 20, Number.NaN, 140]) {
        options.onProgress?.(progress)
        observed.push(queue.get(id)?.progress ?? -1)
      }
      await writeFile(options.outputLocation, 'test video')
      return { bundleLocation: 'test-bundle', outputLocation: options.outputLocation }
    }
    const queue = new RenderQueue({
      renderFilm: render,
      runGate: (videoPath) => Promise.resolve(gateReport(videoPath, true)),
      bundle: () => Promise.resolve('test-bundle')
    })
    queue.submit({ demoId: 'ecc83-pp' })
    await queue.waitForIdle()

    expect(observed).toEqual([50, 50, 50, 100])
  })
})
