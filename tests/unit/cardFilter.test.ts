import { describe, expect, it } from 'vitest'
import type { Card } from '#shared/types/board'
import { addDays, dueStatus, emptyFilter, isFilterActive, matchesFilter } from '../../app/utils/cardFilter'

const today = '2026-10-13'
const card = (over: Partial<Card> = {}): Card => ({
  id: 'c', columnId: 'col', title: 'Fix login bug', description: 'Users see a **500** on submit', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const f = (over: Partial<ReturnType<typeof emptyFilter>>) => ({ ...emptyFilter(), ...over })

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('classifies due dates', () => {
    expect(dueStatus(null, today)).toBeNull()
    expect(dueStatus('2026-10-12', today)).toBe('overdue')
    expect(dueStatus(today, today)).toBe('today')
    expect(dueStatus('2026-10-20', today)).toBe('soon')
    expect(dueStatus('2026-10-21', today)).toBe('later')
  })
})

describe('matchesFilter', () => {
  it('empty filter matches everything and is inactive', () => {
    expect(isFilterActive(emptyFilter())).toBe(false)
    expect(isFilterActive(f({ text: '  ' }))).toBe(false)
    expect(matchesFilter(card(), emptyFilter(), today)).toBe(true)
  })

  it('text needs every word, in title or description, any case', () => {
    expect(matchesFilter(card(), f({ text: 'LOGIN 500' }), today)).toBe(true)
    expect(matchesFilter(card(), f({ text: 'login signup' }), today)).toBe(false)
  })

  it('tags, assignees and priorities match any selected value', () => {
    expect(matchesFilter(card({ tagIds: ['a', 'b'] }), f({ tagIds: ['b', 'z'] }), today)).toBe(true)
    expect(matchesFilter(card({ tagIds: ['a'] }), f({ tagIds: ['z'] }), today)).toBe(false)
    expect(matchesFilter(card({ assigneeIds: ['u1'] }), f({ assigneeIds: ['u1'] }), today)).toBe(true)
    expect(matchesFilter(card(), f({ assigneeIds: ['none'] }), today)).toBe(true)
    expect(matchesFilter(card({ assigneeIds: ['u1'] }), f({ assigneeIds: ['none'] }), today)).toBe(false)
    expect(matchesFilter(card({ priority: 'high' }), f({ priorities: ['high', 'urgent'] }), today)).toBe(true)
    expect(matchesFilter(card(), f({ priorities: ['none'] }), today)).toBe(true)
    expect(matchesFilter(card({ priority: 'low' }), f({ priorities: ['none'] }), today)).toBe(false)
  })

  it('due filters', () => {
    const due = (d: string | null) => card({ dueDate: d })
    expect(matchesFilter(due('2026-10-01'), f({ due: 'overdue' }), today)).toBe(true)
    expect(matchesFilter(due(today), f({ due: 'overdue' }), today)).toBe(false)
    expect(matchesFilter(due(today), f({ due: 'today' }), today)).toBe(true)
    expect(matchesFilter(due('2026-10-20'), f({ due: 'week' }), today)).toBe(true)
    expect(matchesFilter(due('2026-10-21'), f({ due: 'week' }), today)).toBe(false)
    expect(matchesFilter(due('2026-10-01'), f({ due: 'week' }), today)).toBe(false)
    expect(matchesFilter(due(null), f({ due: 'none' }), today)).toBe(true)
    expect(matchesFilter(due(today), f({ due: 'none' }), today)).toBe(false)
  })

  it('start date filters', () => {
    const start = (d: string | null) => card({ startDate: d })
    expect(matchesFilter(start(today), f({ due: 'started' }), today)).toBe(true)
    expect(matchesFilter(start('2026-10-14'), f({ due: 'started' }), today)).toBe(false)
    expect(matchesFilter(start('2026-10-14'), f({ due: 'upcoming' }), today)).toBe(true)
    expect(matchesFilter(start(null), f({ due: 'started' }), today)).toBe(false)
    expect(matchesFilter(start(null), f({ due: 'upcoming' }), today)).toBe(false)
  })

  it('combines filters with AND', () => {
    const c = card({ tagIds: ['a'], priority: 'high' })
    expect(matchesFilter(c, f({ tagIds: ['a'], priorities: ['high'] }), today)).toBe(true)
    expect(matchesFilter(c, f({ tagIds: ['a'], priorities: ['low'] }), today)).toBe(false)
  })

  it('select and checkbox field filters', () => {
    const c = card({ fields: { size: 'l', done: true, flag: false } })
    expect(isFilterActive(f({ fields: { size: [] } }))).toBe(false)
    expect(isFilterActive(f({ fields: { size: ['l'] } }))).toBe(true)
    expect(matchesFilter(c, f({ fields: { size: ['s', 'l'] } }), today)).toBe(true)
    expect(matchesFilter(c, f({ fields: { size: ['s'] } }), today)).toBe(false)
    expect(matchesFilter(c, f({ fields: { size: ['l'], done: ['true'] } }), today)).toBe(true)
    expect(matchesFilter(c, f({ fields: { size: ['l'], done: ['none'] } }), today)).toBe(false)
    // No value and an unticked checkbox both count as 'none'.
    expect(matchesFilter(c, f({ fields: { flag: ['none'], other: ['none'] } }), today)).toBe(true)
    expect(matchesFilter(card(), f({ fields: { size: ['none'] } }), today)).toBe(true)
    expect(matchesFilter(card(), f({ fields: { size: ['l'] } }), today)).toBe(false)
  })
})
