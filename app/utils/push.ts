/**
 * localStorage key: the id of the user who turned push on in this browser. Only
 * that user's sign-ins renew the subscription; signing out clears it, so the
 * next person on a shared device does not get push without asking for it.
 */
export const pushOwnerKey = 'kanban:push'

export function loadPushOwner(): string | null {
  try { return localStorage.getItem(pushOwnerKey) }
  catch { return null }
}

export function savePushOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(pushOwnerKey, userId)
    else localStorage.removeItem(pushOwnerKey)
  }
  catch { /* private mode: push stays on until the browser drops it */ }
}

/** Web Push needs a secure page, a service worker (production builds only) and the Push API. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Whether a subscription was made with `publicKey` (base64url); false when the browser does not say. */
export function sameServerKey(key: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!key) return false
  const a = new Uint8Array(key)
  const b = base64UrlToBytes(publicKey)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The path below the base path of a URL the service worker asks the page to open, or null when it is not ours. */
export function pushTargetPath(url: string, origin: string, base: string): string | null {
  let u: URL
  try { u = new URL(url, origin) }
  catch { return null }
  if (u.origin !== origin) return null
  const prefix = base.replace(/\/+$/, '')
  if (prefix && u.pathname !== prefix && !u.pathname.startsWith(`${prefix}/`)) return null
  return (u.pathname.slice(prefix.length) || '/') + u.search + u.hash
}
