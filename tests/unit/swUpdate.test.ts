// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('applyServiceWorkerUpdate', () => {
  const reload = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true })
    reload.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('closes the streams before activating the worker, and reloads when nothing takes over', async () => {
    const { applyServiceWorkerUpdate, holdServiceWorkerStream, UPDATE_TIMEOUT_MS } = await import('../../app/utils/swUpdate')
    const order: string[] = []
    holdServiceWorkerStream({ release: () => order.push('release'), resume: () => order.push('resume') })
    applyServiceWorkerUpdate(() => { order.push('update') })
    expect(order).toEqual(['release', 'update'])
    vi.advanceTimersByTime(UPDATE_TIMEOUT_MS)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reopens the streams when the update never happens', async () => {
    const { applyServiceWorkerUpdate, holdServiceWorkerStream, UPDATE_TIMEOUT_MS } = await import('../../app/utils/swUpdate')
    const resume = vi.fn()
    holdServiceWorkerStream({ release: () => {}, resume })
    applyServiceWorkerUpdate(() => {})
    vi.advanceTimersByTime(UPDATE_TIMEOUT_MS * 2)
    expect(resume).toHaveBeenCalledOnce()
  })

  it('skips streams that were unregistered', async () => {
    const { applyServiceWorkerUpdate, holdServiceWorkerStream } = await import('../../app/utils/swUpdate')
    const release = vi.fn()
    const unhold = holdServiceWorkerStream({ release, resume: () => {} })
    unhold()
    applyServiceWorkerUpdate(() => {})
    expect(release).not.toHaveBeenCalled()
  })
})
