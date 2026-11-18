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

  it('marks the update so the next load can tell', async () => {
    const { applyServiceWorkerUpdate } = await import('../../app/utils/swUpdate')
    applyServiceWorkerUpdate(() => {})
    expect(sessionStorage.getItem('kanso:sw-update-requested')).toBeTruthy()
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

describe('recoverStuckUpdate', () => {
  const reload = vi.fn()
  const unregister = vi.fn(async () => true)
  let waiting: object | null = null

  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
    reload.mockClear()
    unregister.mockClear()
    waiting = {}
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: () => {},
        getRegistrations: async () => [{ waiting, unregister }],
      },
    })
  })

  it('unregisters and reloads when a worker still waits right after Reload', async () => {
    sessionStorage.setItem('kanso:sw-update-requested', String(Date.now()))
    const { recoverStuckUpdate } = await import('../../app/utils/swUpdate')
    expect(await recoverStuckUpdate()).toBe(true)
    expect(unregister).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    expect(sessionStorage.getItem('kanso:sw-update-requested')).toBeNull()
  })

  it('does nothing without a recent Reload', async () => {
    sessionStorage.setItem('kanso:sw-update-requested', String(Date.now() - 120_000))
    const { recoverStuckUpdate } = await import('../../app/utils/swUpdate')
    expect(await recoverStuckUpdate()).toBe(false)
    expect(unregister).not.toHaveBeenCalled()
  })

  it('does nothing when the update went through', async () => {
    sessionStorage.setItem('kanso:sw-update-requested', String(Date.now()))
    waiting = null
    const { recoverStuckUpdate } = await import('../../app/utils/swUpdate')
    expect(await recoverStuckUpdate()).toBe(false)
    expect(unregister).not.toHaveBeenCalled()
  })

  it('runs once per load, so it cannot loop', async () => {
    sessionStorage.setItem('kanso:sw-update-requested', String(Date.now()))
    const { recoverStuckUpdate, updateRequestedBeforeLoad } = await import('../../app/utils/swUpdate')
    expect(updateRequestedBeforeLoad()).toBe(true)
    expect(await recoverStuckUpdate()).toBe(true)
    vi.resetModules()
    const next = await import('../../app/utils/swUpdate')
    expect(await next.recoverStuckUpdate()).toBe(false)
  })
})
