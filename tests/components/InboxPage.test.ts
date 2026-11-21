import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import type { Inbox, Notification } from '#shared/types/notifications'
import InboxPage from '~/pages/inbox.vue'

const note = (id: string, readAt: string | null, createdAt: Date): Notification => ({
  id, boardId: 'b1', boardName: 'Board one', cardId: `c${id}`, cardTitle: `Card ${id}`, readAt,
  activity: { id: `a${id}`, actorId: 'u', actorName: 'Alice', kind: 'commented', data: {}, createdAt: createdAt.toISOString() },
})

const m = vi.hoisted(() => ({ setRead: vi.fn(), remove: vi.fn(), markAllRead: vi.fn(), loadMore: vi.fn(), state: {} as Record<string, unknown> }))
mockNuxtImport('useInbox', () => () => m.state)

function setup(items: Notification[], extra: Partial<Inbox> = {}) {
  const inbox: Inbox = { items, nextCursor: null, unread: items.filter(i => !i.readAt).length, boards: [{ id: 'b1', name: 'Board one', unread: 1 }], dueSoon: [], ...extra }
  m.state = {
    filter: reactive({ unread: false, boardId: null, event: null }),
    inbox: ref(inbox), items: ref(items), nextCursor: ref(inbox.nextCursor), loading: ref(false), loadingMore: ref(false), failed: ref(false),
    reload: vi.fn(), loadMore: m.loadMore, setRead: m.setRead, remove: m.remove, markAllRead: m.markAllRead, clearRead: vi.fn(),
  }
}

describe('inbox page', () => {
  it('groups by day and toggles read state', async () => {
    const now = new Date()
    const items = [note('1', null, now), note('2', now.toISOString(), new Date(now.getTime() - 3 * 86400000))]
    setup(items, { nextCursor: 'x' })
    const w = await mountSuspended(InboxPage)
    expect(w.text()).toContain('Today')
    expect(w.text()).toContain('1 unread')
    expect(w.text()).toContain('Card 1')
    expect(w.text()).toContain('Card 2')

    await w.find('button[aria-label="Mark read"]').trigger('click')
    expect(m.setRead).toHaveBeenCalledWith(items[0], true)
    await w.find('button[aria-label="Mark unread"]').trigger('click')
    expect(m.setRead).toHaveBeenCalledWith(items[1], false)
    await w.findAll('button[aria-label="Remove from inbox"]')[1]!.trigger('click')
    expect(m.remove).toHaveBeenCalledWith(items[1])

    await w.findAll('button').find(b => b.text() === 'Mark all read')!.trigger('click')
    expect(m.markAllRead).toHaveBeenCalled()
    await w.findAll('button').find(b => b.text() === 'Load more')!.trigger('click')
    expect(m.loadMore).toHaveBeenCalled()
  })

  it('shows an empty state', async () => {
    setup([])
    const w = await mountSuspended(InboxPage)
    expect(w.text()).toContain('Your inbox is empty')
    expect(w.text()).toContain('All caught up')
  })
})
