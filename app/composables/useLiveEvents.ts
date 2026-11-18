import type { BoardEventHandlers, LiveEvents, NotificationEventHandlers } from '~/utils/liveEvents'

let instance: LiveEvents | undefined

const channelOf = (bc: BroadcastChannel) => ({
  postMessage: (m: unknown) => bc.postMessage(m),
  listen: (fn: (data: unknown) => void) => { bc.onmessage = e => fn(e.data) },
})

function create(base: string): LiveEvents {
  const live = createLiveEvents({
    tabId: clientId,
    url: query => `${base}/api/events?${query}`,
    openStream: url => new EventSource(url),
    channel: 'BroadcastChannel' in window ? channelOf(new BroadcastChannel('kanso-events')) : null,
    requestLock: navigator.locks
      ? onLeader => void navigator.locks.request('kanso-events', () => {
          onLeader()
          // Held until the tab closes; the next tab in line then takes over.
          return new Promise<void>(() => {})
        })
      : null,
    onWindow: (type, fn) => window.addEventListener(type, fn),
  })
  // Closed while a service worker update waits for the old worker to go idle.
  holdServiceWorkerStream({ release: live.release, resume: live.resume })
  return live
}

/**
 * Live board and notification events, shared by every tab of the browser over one
 * stream (app/utils/liveEvents.ts). Call during setup; subscribe after mount.
 */
export function useLiveEvents() {
  const base = basePath()
  const get = () => instance ??= create(base)
  return {
    subscribeBoard: (boardId: string, h: BoardEventHandlers) => get().subscribeBoard(boardId, h),
    subscribeNotifications: (h: NotificationEventHandlers) => get().subscribeNotifications(h),
  }
}
