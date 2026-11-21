import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import NotificationBell from '~/components/NotificationBell.vue'

const m = vi.hoisted(() => ({ unread: null as unknown as { value: number } }))
mockNuxtImport('useNotifications', () => () => ({
  inbox: ref(null), unread: m.unread, markRead: vi.fn(), markAllRead: vi.fn(),
}))

describe('NotificationBell', () => {
  it('gives multi-digit unread counts room in the badge', async () => {
    m.unread = ref(42)
    const w = await mountSuspended(NotificationBell)
    const badge = w.findAll('span').find(s => s.text() === '42')
    expect(badge).toBeTruthy()
    const cls = badge!.classes()
    // Horizontal padding so the digits do not touch the edge, and a height
    // above the font size so they are not clipped vertically.
    expect(cls.some(c => /^px-/.test(c))).toBe(true)
    expect(cls).not.toContain('h-[12px]')
  })

  it('caps the count at 99+', async () => {
    m.unread = ref(150)
    const w = await mountSuspended(NotificationBell)
    expect(w.text()).toContain('99+')
  })
})
