import type { Inbox, Notification } from '#shared/types/notifications'

/** The session user's notifications, refetched whenever the server reports a new one. */
export function useNotifications() {
  const showError = useApiError()
  const inbox = ref<Inbox | null>(null)
  const base = basePath()
  const unread = computed(() => inbox.value?.unread ?? 0)

  async function refresh() {
    try {
      inbox.value = await $fetch<Inbox>('/api/notifications')
    }
    catch { /* the bell stays as it was; the next event retries */ }
  }

  let events: EventSource | undefined
  onMounted(() => {
    refresh()
    let failed = false
    events = new EventSource(`${base}/api/notifications/events`)
    events.addEventListener('change', () => refresh())
    // EventSource reconnects by itself; notifications sent while it was down are unknown.
    events.addEventListener('error', () => { failed = true })
    events.addEventListener('open', () => {
      if (failed) refresh()
      failed = false
    })
  })
  onBeforeUnmount(() => events?.close())

  async function markRead(n: Notification) {
    if (n.readAt || !inbox.value) return
    n.readAt = new Date().toISOString()
    inbox.value.unread = Math.max(0, inbox.value.unread - 1)
    try {
      await $fetch(`/api/notifications/${n.id}`, { method: 'PATCH', body: { read: true } })
    }
    catch (err) {
      showError(err)
      await refresh()
    }
  }

  async function markAllRead() {
    if (!inbox.value) return
    const now = new Date().toISOString()
    for (const n of inbox.value.items) n.readAt ??= now
    inbox.value.unread = 0
    try {
      await $fetch('/api/notifications/read-all', { method: 'POST' })
    }
    catch (err) {
      showError(err)
      await refresh()
    }
  }

  return { inbox, unread, refresh, markRead, markAllRead }
}
