import type { Inbox, Notification } from '#shared/types/notifications'
import { defaultInboxFilter, inboxQuery, type InboxFilter } from '~/utils/inbox'

const PAGE = 50

/**
 * The inbox page: filtered, paginated notifications with read/unread and
 * delete. Live events reload what is loaded; the bell follows through
 * useNotificationSync.
 */
export function useInbox() {
  const showError = useApiError()
  const filter = reactive<InboxFilter>(defaultInboxFilter())
  const inbox = ref<Inbox | null>(null)
  const items = ref<Notification[]>([])
  const nextCursor = ref<string | null>(null)
  const loading = ref(false)
  const loadingMore = ref(false)
  const failed = ref(false)
  let request = 0

  /** Reloads the first page, or as many as are loaded (up to 100) so "Load more" progress survives live updates. */
  async function reload(keep = false) {
    const id = ++request
    loading.value = true
    try {
      const limit = keep ? Math.min(100, Math.max(PAGE, items.value.length)) : PAGE
      const res = await $fetch<Inbox>('/api/notifications', { query: inboxQuery(filter, null, limit) })
      if (id !== request) return
      inbox.value = res
      items.value = res.items
      nextCursor.value = res.nextCursor
      failed.value = false
    }
    catch {
      if (id === request) failed.value = true
    }
    finally {
      if (id === request) loading.value = false
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return
    const id = request
    loadingMore.value = true
    try {
      const res = await $fetch<Inbox>('/api/notifications', { query: inboxQuery(filter, nextCursor.value, PAGE) })
      if (id !== request) return
      const known = new Set(items.value.map(n => n.id))
      items.value.push(...res.items.filter(n => !known.has(n.id)))
      nextCursor.value = res.nextCursor
    }
    catch (err) {
      showError(err)
    }
    finally {
      loadingMore.value = false
    }
  }

  const sync = useNotificationSync(() => reload(true))
  watch(filter, () => reload())

  const live = useLiveEvents()
  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    reload()
    unsubscribe = live.subscribeNotifications({ change: () => reload(true), resync: () => reload(true) })
  })
  onBeforeUnmount(() => unsubscribe?.())

  function adjustUnread(n: Notification, delta: number) {
    if (!inbox.value) return
    inbox.value.unread = Math.max(0, inbox.value.unread + delta)
    const b = inbox.value.boards.find(b => b.id === n.boardId)
    if (b) b.unread = Math.max(0, b.unread + delta)
  }

  /** Optimistic change, then the request; on failure a toast and a reload. */
  async function persist(send: () => Promise<unknown>) {
    try {
      await send()
      sync.changed()
      return true
    }
    catch (err) {
      showError(err)
      await reload(true)
      return false
    }
  }

  async function setRead(n: Notification, read: boolean) {
    if (!!n.readAt === read) return
    n.readAt = read ? new Date().toISOString() : null
    adjustUnread(n, read ? -1 : 1)
    if (filter.unread && read) items.value = items.value.filter(i => i.id !== n.id)
    await persist(() => $fetch<unknown>(`/api/notifications/${n.id}`, { method: 'PATCH', body: { read } }))
  }

  async function remove(n: Notification) {
    items.value = items.value.filter(i => i.id !== n.id)
    if (!n.readAt) adjustUnread(n, -1)
    await persist(() => $fetch<unknown>(`/api/notifications/${n.id}`, { method: 'DELETE' }))
  }

  /** Marks everything read, or only the filtered board's notifications. */
  async function markAllRead() {
    const boardId = filter.boardId
    const now = new Date().toISOString()
    for (const n of items.value) n.readAt ??= now
    if (filter.unread) items.value = []
    if (inbox.value) {
      const cleared = boardId ? inbox.value.boards.find(b => b.id === boardId)?.unread ?? 0 : inbox.value.unread
      inbox.value.unread = Math.max(0, inbox.value.unread - cleared)
      for (const b of inbox.value.boards) if (!boardId || b.id === boardId) b.unread = 0
    }
    await persist(() => $fetch<unknown>('/api/notifications/read-all', { method: 'POST', query: boardId ? { boardId } : {} }))
  }

  /** Deletes read notifications (of the filtered board only, when one is picked). */
  async function clearRead() {
    const boardId = filter.boardId
    items.value = items.value.filter(n => !n.readAt)
    if (await persist(() => $fetch<unknown>('/api/notifications/clear-read', { method: 'POST', query: boardId ? { boardId } : {} }))) {
      // Boards without notifications left drop out of the filter list.
      await reload(true)
    }
  }

  return { filter, inbox, items, nextCursor, loading, loadingMore, failed, reload, loadMore, setRead, remove, markAllRead, clearRead }
}
