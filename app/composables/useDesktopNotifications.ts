import type { Notification as AppNotification } from '#shared/types/notifications'

/**
 * Optional browser notifications for new inbox items, off by default and kept per
 * device (localStorage), since the browser's permission is per device as well.
 * `whenFocused` also shows them while Kanso is the focused tab (else a toast).
 */
export function useDesktopNotifications() {
  const enabled = useState('desktop-notifications', () => false)
  const whenFocused = useState('desktop-notifications-focused', () => false)
  const toasts = useState('notification-toasts', () => true)
  const permission = useState<NotificationPermission | 'unsupported'>('desktop-notifications-permission', () => 'default')

  function sync() {
    whenFocused.value = loadDesktopWhenFocused()
    toasts.value = loadNotificationToasts()
    if (!desktopNotificationsSupported()) {
      permission.value = 'unsupported'
      enabled.value = false
      return
    }
    permission.value = Notification.permission
    enabled.value = permission.value === 'granted' && loadDesktopNotificationsEnabled()
  }

  /** Turning it on asks for permission; returns false when the browser refuses. */
  async function setEnabled(on: boolean): Promise<boolean> {
    if (on) {
      if (!desktopNotificationsSupported()) return false
      if (Notification.permission === 'default') await Notification.requestPermission()
      permission.value = Notification.permission
      if (permission.value !== 'granted') return false
    }
    saveDesktopNotificationsEnabled(on)
    enabled.value = on
    return true
  }

  function setWhenFocused(on: boolean) {
    saveDesktopWhenFocused(on)
    whenFocused.value = on
  }

  function setToasts(on: boolean) {
    saveNotificationToasts(on)
    toasts.value = on
  }

  return { enabled, whenFocused, toasts, permission, sync, setEnabled, setWhenFocused, setToasts }
}

/** At most this many toasts at once; more become one summary toast. */
const MAX_TOASTS = 3

/**
 * Shows new inbox items as in-app toasts (unless switched off on this device) and,
 * when turned on and allowed, as system notifications while the tab is in the
 * background (also while focused when the user asked for that).
 */
export function useDesktopNotifier() {
  const { enabled, whenFocused, toasts, sync } = useDesktopNotifications()
  const { user } = useUserSession()
  const i18n = useI18nContext()
  const toast = useToast()
  const route = useRoute()
  const icon = appUrl('/pwa-192x192.png')
  let seen: Set<string> | null = null

  onMounted(sync)

  const describe = (n: AppNotification) =>
    `${actorLabel(n.activity.actorName, n.activity, i18n)} ${describeNotification(n.activity, i18n, user.value?.id)}`

  function showDesktop(items: AppNotification[], open: (n: AppNotification) => void) {
    for (const n of items) {
      try {
        // Same tag in several tabs: the browser shows it once.
        const shown = new Notification(n.cardTitle, {
          body: `${describe(n)}\n${n.boardName}`,
          tag: `kanso-notification-${n.id}`,
          icon,
        })
        shown.onclick = () => {
          window.focus()
          shown.close()
          open(n)
        }
      }
      catch { /* Chrome on Android only allows notifications from a service worker */ }
    }
  }

  function showToasts(items: AppNotification[], open: (n: AppNotification) => void) {
    // The card open in this tab shows the change already.
    const fresh = items.filter(n => !(route.query.card === n.cardId && route.path.endsWith(`/boards/${n.boardId}`)))
    if (fresh.length > MAX_TOASTS) {
      toast.add({ title: i18n.t('notifications.toastMany', { count: fresh.length }, fresh.length), icon: 'i-lucide-bell' })
      return
    }
    for (const n of fresh) {
      toast.add({
        title: n.cardTitle,
        description: `${describe(n)} · ${n.boardName}`,
        icon: 'i-lucide-bell',
        actions: [{ label: i18n.t('notifications.toastOpen'), color: 'neutral', variant: 'outline', onClick: () => open(n) }],
      })
    }
  }

  function notify(items: AppNotification[], open: (n: AppNotification) => void) {
    const fresh = newUnreadNotifications(items, seen)
    seen = new Set([...(seen ?? []), ...items.map(n => n.id)])
    if (!fresh.length) return
    const desktop = enabled.value && desktopNotificationsSupported() && Notification.permission === 'granted'
    const focused = document.visibilityState === 'visible' && document.hasFocus()
    if (showDesktopNotification({ focused, desktop, desktopWhenFocused: whenFocused.value })) showDesktop(fresh, open)
    if (toasts.value) showToasts(fresh, open)
  }

  return { notify }
}
