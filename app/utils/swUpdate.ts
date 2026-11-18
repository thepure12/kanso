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

/**
 * Set in this tab's sessionStorage when Reload is clicked, read (and cleared) on the
 * next load: if a worker is still waiting then, the update got stuck.
 */
const REQUESTED_KEY = 'kanso:sw-update-requested'
/** Older marks are ignored (the tab was not reloaded by the update). */
export const REQUESTED_MAX_AGE_MS = 60_000

let requestedOnLoad: boolean | undefined

/** Whether this page load follows a click on Reload; read once per load. */
export function updateRequestedBeforeLoad(): boolean {
  if (requestedOnLoad !== undefined) return requestedOnLoad
  requestedOnLoad = false
  try {
    const at = Number(sessionStorage.getItem(REQUESTED_KEY))
    sessionStorage.removeItem(REQUESTED_KEY)
    requestedOnLoad = at > 0 && Date.now() - at < REQUESTED_MAX_AGE_MS
  }
  catch { /* storage blocked: no recovery, the toast stays */ }
  return requestedOnLoad
}

/**
 * Called when a waiting worker is found. If the page was reloaded by an update and a
 * worker still waits, the old one never let go (seen in Firefox): unregister the
 * service worker and reload, as unregistering by hand did. The next load installs
 * the new worker fresh; the offline caches fill again and push re-subscribes
 * (usePushNotifications().sync). The mark is gone by then, so this runs once.
 * Returns true when it recovers (the caller skips the toast).
 */
export async function recoverStuckUpdate(): Promise<boolean> {
  if (!updateRequestedBeforeLoad() || !('serviceWorker' in navigator)) return false
  const registrations = await navigator.serviceWorker.getRegistrations()
  if (!registrations.some(r => r.waiting)) return false
  await Promise.all(registrations.map(r => r.unregister()))
  window.location.reload()
  return true
}

/** Closes every tab's streams, then activates the waiting worker; reloads either way. */
export function applyServiceWorkerUpdate(update: () => Promise<void> | void) {
  setup()
  try { sessionStorage.setItem(REQUESTED_KEY, String(Date.now())) }
  catch { /* storage blocked */ }
  channel?.postMessage('release')
  releaseAll()
  void update()
  setTimeout(() => window.location.reload(), UPDATE_TIMEOUT_MS)
}
