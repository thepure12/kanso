// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Notification } from '#shared/types/notifications'
import { loadNotificationToasts, newUnreadNotifications, notificationToastsKey, saveNotificationToasts, showDesktopNotification } from '../../app/utils/desktopNotifications'

const n = (id: string, read = false) => ({ id, readAt: read ? '2026-01-01T00:00:00Z' : null }) as Notification

describe('newUnreadNotifications', () => {
  it('treats the first load as already seen', () => {
    expect(newUnreadNotifications([n('a'), n('b')], null)).toEqual([])
  })

  it('returns unseen unread items oldest first', () => {
    const items = [n('c'), n('b', true), n('a'), n('old')]
    expect(newUnreadNotifications(items, new Set(['old'])).map(x => x.id)).toEqual(['a', 'c'])
  })

  it('does not repeat items already seen', () => {
    expect(newUnreadNotifications([n('a')], new Set(['a']))).toEqual([])
  })
})

describe('showDesktopNotification', () => {
  const show = (focused: boolean, desktop: boolean, desktopWhenFocused: boolean) =>
    showDesktopNotification({ focused, desktop, desktopWhenFocused })

  it('shows one in the background when desktop notifications are on', () => {
    expect(show(false, true, false)).toBe(true)
    expect(show(false, false, false)).toBe(false)
  })

  it('shows one while focused only when asked to', () => {
    expect(show(true, true, false)).toBe(false)
    expect(show(true, true, true)).toBe(true)
    expect(show(true, false, true)).toBe(false)
  })
})

describe('notification toasts setting', () => {
  it('is on by default and remembers off', () => {
    localStorage.removeItem(notificationToastsKey)
    expect(loadNotificationToasts()).toBe(true)
    saveNotificationToasts(false)
    expect(loadNotificationToasts()).toBe(false)
    saveNotificationToasts(true)
    expect(loadNotificationToasts()).toBe(true)
  })
})
