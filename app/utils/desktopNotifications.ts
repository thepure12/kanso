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

/** localStorage key for "desktop notifications also while Kanso is focused" (per device). */
export const desktopWhenFocusedKey = 'kanban:desktop-notifications-focused'

export function loadDesktopWhenFocused(): boolean {
  try { return localStorage.getItem(desktopWhenFocusedKey) === '1' }
  catch { return false }
}

export function saveDesktopWhenFocused(on: boolean) {
  try {
    if (on) localStorage.setItem(desktopWhenFocusedKey, '1')
    else localStorage.removeItem(desktopWhenFocusedKey)
  }
  catch { /* private mode: the switch lasts for this page only */ }
}

/** localStorage key for in-app toasts of new notifications (per device, on unless '0'). */
export const notificationToastsKey = 'kanban:notification-toasts'

export function loadNotificationToasts(): boolean {
  try { return localStorage.getItem(notificationToastsKey) !== '0' }
  catch { return true }
}

export function saveNotificationToasts(on: boolean) {
  try {
    if (on) localStorage.removeItem(notificationToastsKey)
    else localStorage.setItem(notificationToastsKey, '0')
  }
  catch { /* private mode: the switch lasts for this page only */ }
}

/**
 * Whether a new notification also becomes a desktop notification: while the tab is
 * in the background, or while focused when the user asked for that. In-app toasts
 * are separate (their own switch).
 */
export function showDesktopNotification(o: { focused: boolean, desktop: boolean, desktopWhenFocused: boolean }): boolean {
  return o.desktop && (!o.focused || o.desktopWhenFocused)
}
