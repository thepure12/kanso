import { describe, expect, it } from 'vitest'
import type { Notification } from '#shared/types/notifications'
import { newUnreadNotifications } from '../../app/utils/desktopNotifications'

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
