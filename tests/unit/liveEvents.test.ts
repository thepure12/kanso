import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveEvents, RESUBSCRIBE_MS, RETRY_CLOSED_MS, type LiveEvents } from '../../app/utils/liveEvents'

class FakeStream {
  static all: FakeStream[] = []
  readyState = 0
  closed = false
  listeners = new Map<string, ((e: { data?: unknown }) => void)[]>()
  constructor(public url: string) { FakeStream.all.push(this) }
  addEventListener(type: string, fn: (e: { data?: unknown }) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], fn])
  }

  emit(type: string, data?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: data === undefined ? '' : JSON.stringify(data) })
  }

  close() { this.closed = true }
  get query() { return Object.fromEntries(new URL(this.url, 'http://x').searchParams) }
}

const open = () => FakeStream.all.filter(s => !s.closed)

/** BroadcastChannel and Web Locks shared by the fake tabs. */
function browser() {
  const members = new Set<{ tab: string, fn: (data: unknown) => void }>()
  const queue: { tab: string, grant: () => void }[] = []
  let holder: string | undefined
  const grantNext = () => {
    const next = queue.shift()
    if (!next) return
    holder = next.tab
    next.grant()
  }
  return {
    tab(tabId: string, opts: { noLocks?: boolean } = {}): LiveEvents & { close: () => void } {
      const member = { tab: tabId, fn: (_: unknown) => {} }
      members.add(member)
      const live = createLiveEvents({
        tabId,
        url: q => `/api/events?${q}`,
        openStream: url => new FakeStream(url),
        channel: {
          postMessage: m => queueMicrotask(() => {
            for (const other of members) if (other !== member) other.fn(structuredClone(m))
          }),
          listen: (fn) => { member.fn = fn },
        },
        requestLock: opts.noLocks
          ? null
          : (onLeader) => {
              queue.push({ tab: tabId, grant: onLeader })
              if (!holder) grantNext()
            },
      })
      return Object.assign(live, {
        close() {
          members.delete(member)
          for (const s of open()) if (holder === tabId) s.close()
          if (holder === tabId) {
            holder = undefined
            grantNext()
          }
        },
      })
    },
  }
}

const handlers = () => ({ change: vi.fn(), gone: vi.fn(), resync: vi.fn() })
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(RESUBSCRIBE_MS)
}

describe('createLiveEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeStream.all = []
  })
  afterEach(() => vi.useRealTimers())

  it('opens one stream for every tab and relays the events', async () => {
    const b = browser()
    const a = b.tab('tab-a')
    const c = b.tab('tab-c')
    const ha = handlers()
    const hc = handlers()
    const notes = { change: vi.fn(), resync: vi.fn() }
    a.subscribeBoard('board-1', ha)
    a.subscribeNotifications(notes)
    await settle()
    FakeStream.all[0]!.emit('ready')
    c.subscribeBoard('board-2', hc)
    await settle()

    expect(a.isLeader).toBe(true)
    expect(c.isLeader).toBe(false)
    const [first, second] = FakeStream.all
    expect(first!.query).toEqual({ boards: 'board-1', clients: 'tab-a', notifications: '1' })
    expect(second!.query).toEqual({ boards: 'board-1,board-2', clients: 'tab-a,tab-c', notifications: '1' })
    // The old stream stays until the new one is subscribed.
    expect(first!.closed).toBe(false)
    second!.emit('ready')
    expect(first!.closed).toBe(true)
    expect(open()).toEqual([second])

    second!.emit('change', { b: 'board-2', c: [''] })
    second!.emit('notifications')
    await settle()
    expect(hc.change).toHaveBeenCalledOnce()
    expect(ha.change).not.toHaveBeenCalled()
    expect(notes.change).toHaveBeenCalledOnce()
    expect(hc.resync).not.toHaveBeenCalled()
  })

  it('skips changes made only by the tab itself', async () => {
    const b = browser()
    const a = b.tab('tab-a')
    const c = b.tab('tab-c')
    const ha = handlers()
    const hc = handlers()
    a.subscribeBoard('board-1', ha)
    c.subscribeBoard('board-1', hc)
    await settle()
    const s = open()[0]!
    s.emit('ready')

    s.emit('change', { b: 'board-1', c: ['tab-c'] })
    await settle()
    expect(ha.change).toHaveBeenCalledTimes(1)
    expect(hc.change).not.toHaveBeenCalled()

    s.emit('change', { b: 'board-1', c: ['tab-c', ''] })
    await settle()
    expect(hc.change).toHaveBeenCalledOnce()
  })

  it('closes the stream when nobody listens and drops boards that are gone', async () => {
    const b = browser()
    const a = b.tab('tab-a')
    const h = handlers()
    const off = a.subscribeBoard('board-1', h)
    a.subscribeBoard('board-2', handlers())
    await settle()
    const s = open()[0]!
    s.emit('ready')
    s.emit('gone', { b: 'board-1' })
    expect(h.gone).toHaveBeenCalledOnce()
    off()
    await settle()
    expect(open().at(-1)!.query.boards).toBe('board-2')
  })

  it('hands the stream to the next tab and resyncs when the leader closes', async () => {
    const b = browser()
    const a = b.tab('tab-a')
    const c = b.tab('tab-c')
    a.subscribeBoard('board-1', handlers())
    const hc = handlers()
    c.subscribeBoard('board-2', hc)
    await settle()
    await settle()
    open().at(-1)!.emit('ready')
    a.close()
    await settle()
    await settle()

    expect(c.isLeader).toBe(true)
    const s = open()
    expect(s).toHaveLength(1)
    expect(s[0]!.query).toEqual({ boards: 'board-2', clients: 'tab-c' })
    s[0]!.emit('ready')
    expect(hc.resync).toHaveBeenCalledOnce()
  })

  it('resyncs after the stream dropped, and retries one the browser gave up on', async () => {
    const b = browser()
    const a = b.tab('tab-a')
    const h = handlers()
    a.subscribeBoard('board-1', h)
    await settle()
    const s = open()[0]!
    s.emit('ready')
    s.emit('error')
    s.emit('ready')
    expect(h.resync).toHaveBeenCalledOnce()

    s.readyState = 2
    s.emit('error')
    await vi.advanceTimersByTimeAsync(RETRY_CLOSED_MS + RESUBSCRIBE_MS)
    expect(s.closed).toBe(true)
    const again = open()
    expect(again).toHaveLength(1)
    again[0]!.emit('ready')
    expect(h.resync).toHaveBeenCalledTimes(2)
  })

  it('leads alone without Web Locks', async () => {
    const b = browser()
    const a = b.tab('tab-a', { noLocks: true })
    const c = b.tab('tab-c', { noLocks: true })
    a.subscribeBoard('board-1', handlers())
    c.subscribeBoard('board-2', handlers())
    await settle()
    expect(open().map(s => s.query.boards).sort()).toEqual(['board-1', 'board-2'])
  })

  it('closes while a service worker update waits and resyncs on resume', async () => {
    const b = browser()
    const a = b.tab('tab-a')
    const h = handlers()
    a.subscribeBoard('board-1', h)
    await settle()
    open()[0]!.emit('ready')
    a.release()
    expect(open()).toHaveLength(0)
    a.resume()
    await settle()
    open()[0]!.emit('ready')
    expect(h.resync).toHaveBeenCalledOnce()
  })
})
