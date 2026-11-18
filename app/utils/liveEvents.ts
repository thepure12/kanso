/**
 * Live updates over one server-sent event stream per browser (GET /api/events).
 *
 * Over HTTP/1.1 a browser opens at most six connections per host, and a stream per
 * tab and purpose used them all up with a few tabs open, so every other request
 * waited. Instead, one tab leads (it holds the `kanso-events` Web Lock), opens the
 * single stream for the boards every tab shows and relays its events to the other
 * tabs over a BroadcastChannel. When the leading tab closes, its lock is released
 * and the next tab in line takes over. Without Web Locks or BroadcastChannel each
 * tab leads alone (one stream per tab).
 *
 * Messages on the channel:
 * - from any tab: `subs` (its boards, whether it wants notifications), `bye` on pagehide;
 * - from the leader: `hello` (it took over; every tab answers with `subs`), and the
 *   stream's events `change`, `gone`, `notifications`, `resync`.
 *
 * `resync` tells subscribers that events may have been missed (the stream dropped,
 * the leader changed, the device came back online): they reload what they show.
 */

export interface BoardEventHandlers {
  /** Someone else changed the board. */
  change: () => void
  /** The user cannot see the board (any more). */
  gone: () => void
  /** Events may have been missed. */
  resync: () => void
}

export interface NotificationEventHandlers {
  /** A new notification arrived. */
  change: () => void
  /** Events may have been missed. */
  resync: () => void
}

interface Subs { boards: string[], notifications: boolean }

type Message =
  | { t: 'subs', tab: string } & Subs
  | { t: 'bye', tab: string }
  | { t: 'hello' }
  | { t: 'change', b: string, c: string[] }
  | { t: 'gone', b: string }
  | { t: 'notifications' }
  | { t: 'resync' }

interface Channel {
  postMessage: (m: unknown) => void
  /** Receives the other tabs' messages. */
  listen: (fn: (data: unknown) => void) => void
}

interface Stream {
  addEventListener: (type: string, fn: (e: { data?: unknown }) => void) => void
  close: () => void
  readonly readyState: number
}

export interface LiveEventsDeps {
  /** This tab's id (the x-client-id of its requests). */
  tabId: string
  /** The stream URL for a query string ('boards=...&clients=...'). */
  url: (query: string) => string
  openStream: (url: string) => Stream
  /** null: no BroadcastChannel; the tab then leads alone. */
  channel: Channel | null
  /** Waits for the lock, then calls `onLeader`; null: no Web Locks. */
  requestLock: ((onLeader: () => void) => void) | null
  /** Adds window listeners; skipped in tests. */
  onWindow?: (type: 'pagehide' | 'pageshow' | 'online', fn: (e: Event) => void) => void
}

/** Matches the server's caps (server/api/events.get.ts). */
export const MAX_STREAM_BOARDS = 50
export const MAX_STREAM_CLIENTS = 50
/** Debounce of subscription changes before the stream is reopened. */
export const RESUBSCRIBE_MS = 50
/** Wait before reopening a stream the browser gave up on (e.g. after a 401). */
export const RETRY_CLOSED_MS = 15_000

const CLOSED = 2

export function createLiveEvents(deps: LiveEventsDeps) {
  const { tabId } = deps
  const boardHandlers = new Map<string, Set<BoardEventHandlers>>()
  const notificationHandlers = new Set<NotificationEventHandlers>()

  let started = false
  let leader = false
  /** A leader existed before this tab took over: events may have been missed. */
  let sawLeader = false
  /** Leader: every tab's subscriptions (this tab's come from the handlers). */
  const tabs = new Map<string, Subs>()
  let held = false

  const localSubs = (): Subs => ({
    boards: [...boardHandlers].filter(([, set]) => set.size).map(([b]) => b),
    notifications: notificationHandlers.size > 0,
  })

  // --- delivering events to this tab's subscribers

  function deliver(m: Message) {
    switch (m.t) {
      case 'change':
        // Skip bursts made only by this tab.
        if (m.c.length && m.c.every(c => c === tabId)) return
        for (const h of [...boardHandlers.get(m.b) ?? []]) h.change()
        return
      case 'gone':
        for (const h of [...boardHandlers.get(m.b) ?? []]) h.gone()
        return
      case 'notifications':
        for (const h of [...notificationHandlers]) h.change()
        return
      case 'resync':
        for (const set of [...boardHandlers.values()]) for (const h of [...set]) h.resync()
        for (const h of [...notificationHandlers]) h.resync()
    }
  }

  /** Leader: to this tab and all others. */
  function dispatch(m: Message) {
    deps.channel?.postMessage(m)
    deliver(m)
  }

  // --- leader: the stream

  interface Open { stream: Stream, key: string, failed: boolean }
  let current: Open | undefined
  let pending: Open | undefined
  let needResync = false
  let resubscribeTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function wanted() {
    const boards = new Set<string>()
    const clients = new Set<string>()
    let notifications = false
    for (const [tab, subs] of [[tabId, localSubs()] as const, ...[...tabs].filter(([t]) => t !== tabId)]) {
      if (!subs.boards.length && !subs.notifications) continue
      clients.add(tab)
      for (const b of subs.boards) boards.add(b)
      notifications ||= subs.notifications
    }
    if (!boards.size && !notifications) return ''
    const q = new URLSearchParams()
    if (boards.size) q.set('boards', [...boards].sort().slice(0, MAX_STREAM_BOARDS).join(','))
    // This tab first, so it stays in the list.
    q.set('clients', [tabId, ...[...clients].filter(c => c !== tabId).sort()].slice(0, MAX_STREAM_CLIENTS).join(','))
    if (notifications) q.set('notifications', '1')
    return q.toString()
  }

  function closeAll() {
    current?.stream.close()
    pending?.stream.close()
    current = pending = undefined
    clearTimeout(retryTimer)
  }

  function open(key: string) {
    pending?.stream.close()
    const s: Open = { stream: deps.openStream(deps.url(key)), key, failed: false }
    pending = s
    const live = () => s === current || s === pending
    s.stream.addEventListener('ready', () => {
      if (!live()) return
      if (s === pending) {
        // The new subscriptions are in place: the old stream can go.
        current?.stream.close()
        current = s
        pending = undefined
      }
      if (s.failed || needResync) dispatch({ t: 'resync' })
      s.failed = false
      needResync = false
    })
    s.stream.addEventListener('error', () => {
      if (!live()) return
      // EventSource reconnects by itself (a new `ready` follows); after a refusal
      // (401, 404) it gives up, so try again later.
      s.failed = true
      if (s.stream.readyState === CLOSED) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          if (!live() || !leader || held) return
          needResync = true
          closeAll()
          update()
        }, RETRY_CLOSED_MS)
      }
    })
    const relay = (fn: (data: Record<string, unknown>) => Message | undefined) => (e: { data?: unknown }) => {
      if (!live()) return
      let data: Record<string, unknown> = {}
      try { data = typeof e.data === 'string' && e.data ? JSON.parse(e.data) : {} }
      catch { return }
      const m = fn(data)
      if (m) dispatch(m)
    }
    s.stream.addEventListener('change', relay(d => typeof d.b === 'string' && Array.isArray(d.c)
      ? { t: 'change', b: d.b, c: d.c.filter((c): c is string => typeof c === 'string') }
      : undefined))
    s.stream.addEventListener('gone', relay((d) => {
      if (typeof d.b !== 'string') return
      // Out of every tab's list, so the next stream leaves it out.
      for (const subs of tabs.values()) subs.boards = subs.boards.filter(b => b !== d.b)
      return { t: 'gone', b: d.b }
    }))
    s.stream.addEventListener('notifications', relay(() => ({ t: 'notifications' })))
  }

  /** Leader: (re)opens the stream when what the tabs want changed. */
  function update() {
    if (!leader || held) return
    clearTimeout(resubscribeTimer)
    resubscribeTimer = setTimeout(() => {
      if (!leader || held) return
      const key = wanted()
      if (!key) return closeAll()
      if ((pending ?? current)?.key === key) return
      open(key)
    }, RESUBSCRIBE_MS)
  }

  function becomeLeader() {
    leader = true
    needResync = sawLeader
    deps.channel?.postMessage({ t: 'hello' } satisfies Message)
    update()
  }

  // --- followers

  function announce() {
    if (leader) update()
    else deps.channel?.postMessage({ t: 'subs', tab: tabId, ...localSubs() } satisfies Message)
  }

  function onMessage(m: Message) {
    if (m.t === 'subs') {
      if (!leader) return
      tabs.set(m.tab, { boards: m.boards, notifications: m.notifications })
      update()
    }
    else if (m.t === 'bye') {
      if (!leader) return
      tabs.delete(m.tab)
      update()
    }
    else if (m.t === 'hello') {
      sawLeader = true
      announce()
    }
    else if (!leader) {
      sawLeader = true
      deliver(m)
    }
  }

  function start() {
    if (started) return
    started = true
    if (deps.channel && deps.requestLock) {
      deps.channel.listen(data => onMessage(data as Message))
      deps.requestLock(becomeLeader)
    }
    else becomeLeader()
    deps.onWindow?.('pagehide', () => {
      if (!leader) deps.channel?.postMessage({ t: 'bye', tab: tabId } satisfies Message)
    })
    deps.onWindow?.('pageshow', (e) => {
      if ((e as PageTransitionEvent).persisted) announce()
    })
    // Back online: the browser may not have noticed the drop; reopen and reload.
    deps.onWindow?.('online', () => {
      if (!leader || held) return
      needResync = true
      closeAll()
      update()
    })
  }

  function subscribe<T>(set: Set<T>, h: T) {
    start()
    set.add(h)
    announce()
    let done = false
    return () => {
      if (done) return
      done = true
      set.delete(h)
      announce()
    }
  }

  return {
    /** Live events of one board; returns the unsubscribe function. */
    subscribeBoard(boardId: string, h: BoardEventHandlers) {
      let set = boardHandlers.get(boardId)
      if (!set) boardHandlers.set(boardId, set = new Set())
      const off = subscribe(set, h)
      return () => {
        off()
        if (!set.size && boardHandlers.get(boardId) === set) boardHandlers.delete(boardId)
      }
    },
    /** Notification events of the session user; returns the unsubscribe function. */
    subscribeNotifications(h: NotificationEventHandlers) {
      return subscribe(notificationHandlers, h)
    },
    /** Closes the stream while a service worker update waits (app/utils/swUpdate.ts). */
    release() {
      held = true
      closeAll()
    },
    /** Reopens it when the update did not happen after all. */
    resume() {
      held = false
      needResync = true
      update()
    },
    /** For tests. */
    get isLeader() { return leader },
  }
}

export type LiveEvents = ReturnType<typeof createLiveEvents>
