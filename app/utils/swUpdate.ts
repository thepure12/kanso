/**
 * Activating a waiting service worker (the "Update available" toast).
 *
 * Firefox keeps a new worker waiting, even after skipWaiting, until the old one is
 * idle, and the open live-update streams (EventSource) of every Kanso tab keep it
 * busy: the toast came back on every load until all tabs were closed. So applying
 * the update first tells every tab (BroadcastChannel) to close its streams, then
 * sends SKIP_WAITING. Each controlled tab reloads when the new worker takes over
 * (controllerchange). If that does not happen in time, the tab that asked reloads
 * anyway and the others reopen their streams.
 */

interface StreamHolder {
  /** Close the stream so the old service worker can go idle. */
  release: () => void
  /** Reopen it when the update did not happen after all. */
  resume: () => void
}

const holders = new Set<StreamHolder>()
const CHANNEL = 'kanso-sw-update'
export const UPDATE_TIMEOUT_MS = 5000

let channel: BroadcastChannel | undefined
let resumeTimer: ReturnType<typeof setTimeout> | undefined
let reloadOnControllerChange = false

function releaseAll() {
  reloadOnControllerChange = true
  for (const h of holders) h.release()
  clearTimeout(resumeTimer)
  resumeTimer = setTimeout(() => {
    reloadOnControllerChange = false
    for (const h of holders) h.resume()
  }, UPDATE_TIMEOUT_MS * 2)
}

function setup() {
  if (channel || typeof window === 'undefined') return
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (e) => { if (e.data === 'release') releaseAll() }
  }
  // The PWA client reloads on Workbox's 'controlling' event only when the page was
  // controlled at load; reload on any takeover once an update was requested.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadOnControllerChange) window.location.reload()
    })
  }
}

/** Registers a live stream that must be closed while the service worker updates. */
export function holdServiceWorkerStream(holder: StreamHolder) {
  setup()
  holders.add(holder)
  return () => { holders.delete(holder) }
}

/** Closes every tab's streams, then activates the waiting worker; reloads either way. */
export function applyServiceWorkerUpdate(update: () => Promise<void> | void) {
  setup()
  channel?.postMessage('release')
  releaseAll()
  void update()
  setTimeout(() => window.location.reload(), UPDATE_TIMEOUT_MS)
}
