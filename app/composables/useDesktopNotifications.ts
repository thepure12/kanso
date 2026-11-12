import type { Notification as AppNotification } from '#shared/types/notifications'

/**
 * Optional browser notifications for new inbox items, off by default and kept per
 * device (localStorage), since the browser's permission is per device as well.
 */
export function useDesktopNotifications() {
  const enabled = useState('desktop-notifications', () => false)
  const permission = useState<NotificationPermission | 'unsupported'>('desktop-notifications-permission', () => 'default')

  function sync() {
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

  return { enabled, permission, sync, setEnabled }
}

/** Shows inbox items as system notifications while the tab is in the background. */
export function useDesktopNotifier() {
  const { enabled, sync } = useDesktopNotifications()
  const { user } = useUserSession()
  const i18n = useI18nContext()
  const icon = appUrl('/pwa-192x192.png')
  let seen: Set<string> | null = null

  onMounted(sync)

  function notify(items: AppNotification[], open: (n: AppNotification) => void) {
    const fresh = newUnreadNotifications(items, seen)
    seen = new Set([...(seen ?? []), ...items.map(n => n.id)])
    if (!fresh.length || !enabled.value || !desktopNotificationsSupported() || Notification.permission !== 'granted') return
    // A tab the user is looking at already shows the bell's badge.
    if (document.visibilityState === 'visible' && document.hasFocus()) return
    for (const n of fresh) {
      const actor = actorLabel(n.activity.actorName, n.activity, i18n)
      try {
        // Same tag in several tabs: the browser shows it once.
        const shown = new Notification(n.cardTitle, {
          body: `${actor} ${describeNotification(n.activity, i18n, user.value?.id)}\n${n.boardName}`,
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

  return { notify }
}
