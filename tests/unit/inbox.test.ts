import { describe, expect, it } from 'vitest'
import type { Notification } from '#shared/types/notifications'
import { defaultInboxFilter, groupInbox, inboxQuery } from '../../app/utils/inbox'

const note = (id: string, createdAt: Date): Notification => ({
  id, boardId: 'b', boardName: 'B', cardId: 'c', cardTitle: 'C', readAt: null,
  activity: { id: `a${id}`, actorId: null, actorName: null, kind: 'commented', data: {}, createdAt: createdAt.toISOString() },
})

describe('inboxQuery', () => {
  it('leaves out defaults', () => {
    expect(inboxQuery(defaultInboxFilter())).toEqual({})
  })
  it('passes filters, cursor and limit', () => {
    expect(inboxQuery({ unread: true, boardId: 'x', event: 'mentioned' }, 'cur', 20))
      .toEqual({ unread: '1', boardId: 'x', event: 'mentioned', before: 'cur', limit: '20' })
  })
})

describe('groupInbox', () => {
  it('groups by local day: today, yesterday, then dates', () => {
    const items = [
      note('1', new Date(2026, 10, 21, 9)),
      note('2', new Date(2026, 10, 21, 0, 5)),
      note('3', new Date(2026, 10, 20, 23)),
      note('4', new Date(2026, 10, 18, 12)),
      note('5', new Date(2026, 10, 18, 8)),
      note('6', new Date(2026, 9, 1, 8)),
    ]
    expect(groupInbox(items, '2026-11-21').map(g => [g.key, g.day, g.items.map(i => i.id)])).toEqual([
      ['today', 'today', ['1', '2']],
      ['yesterday', 'yesterday', ['3']],
      ['2026-11-18', 'earlier', ['4', '5']],
      ['2026-10-01', 'earlier', ['6']],
    ])
  })
  it('handles a month boundary for yesterday', () => {
    expect(groupInbox([note('1', new Date(2026, 10, 30, 12))], '2026-12-01')[0]!.day).toBe('yesterday')
  })
})
