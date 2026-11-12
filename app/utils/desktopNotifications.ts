import type { Notification as AppNotification } from '#shared/types/notifications'

/** localStorage key for the per-device switch (browser permission is per device too). */
export const desktopNotificationsKey = 'kanban:desktop-notifications'

export function desktopNotificationsSupported(): boolean {
  // Browsers only allow notifications on https or localhost.
  return typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window
}

export function loadDesktopNotificationsEnabled(): boolean {
  try { return localStorage.getItem(desktopNotificationsKey) === '1' }
  catch { return false }
}

export function saveDesktopNotificationsEnabled(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(desktopNotificationsKey, '1')
    else localStorage.removeItem(desktopNotificationsKey)
  }
  catch { /* private mode: the switch lasts for this page only */ }
}

/**
 * Unread notifications whose id is not in `seen`, oldest first (the inbox lists newest
 * first). With `seen` null (first load) nothing is new, so opening the app does not
 * replay the inbox.
 */
export function newUnreadNotifications(items: AppNotification[], seen: Set<string> | null): AppNotification[] {
  const fresh = seen ? items.filter(n => !n.readAt && !seen.has(n.id)) : []
  return fresh.reverse()
}
