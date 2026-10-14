import { describe, expect, it } from 'vitest'
import type { Card } from '#shared/types/board'
import { cardsByDate, daysBetween, monthGrid, monthTitle, moveDatePatch, shiftMonth, weekdayNames } from '../../app/utils/calendar'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c', columnId: 'col', title: 'Card', description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})

describe('monthGrid', () => {
  it('covers the month in Monday-first weeks', () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const weeks = monthGrid('2026-10')
    expect(weeks).toHaveLength(5)
    expect(weeks[0]![0]).toBe('2026-09-28')
    expect(weeks[0]![3]).toBe('2026-10-01')
    expect(weeks.at(-1)!.at(-1)).toBe('2026-11-01')
    expect(weeks.every(w => w.length === 7)).toBe(true)
  })

  it('starts on the 1st when it is a Monday and handles six-week months', () => {
    expect(monthGrid('2026-06')[0]![0]).toBe('2026-06-01')
    // August 2026 starts on a Saturday and has 31 days.
    expect(monthGrid('2026-08')).toHaveLength(6)
  })

  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})

describe('labels', () => {
  it('names weekdays Monday first and months in the locale', () => {
    expect(weekdayNames('en-GB')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(weekdayNames('de')[0]).toBe('Mo')
    expect(monthTitle('2026-10', 'en-GB')).toBe('October 2026')
  })
})

describe('cardsByDate', () => {
  it('groups by due or start date with undated cards under null', () => {
    const a = card({ id: 'a', dueDate: '2026-10-14', startDate: '2026-10-10' })
    const b = card({ id: 'b', dueDate: '2026-10-14' })
    const c = card({ id: 'c' })
    const due = cardsByDate([a, b, c], 'due')
    expect(due.get('2026-10-14')!.map(x => x.id)).toEqual(['a', 'b'])
    expect(due.get(null)!.map(x => x.id)).toEqual(['c'])
    const start = cardsByDate([a, b, c], 'start')
    expect(start.get('2026-10-10')!.map(x => x.id)).toEqual(['a'])
    expect(start.get(null)!.map(x => x.id)).toEqual(['b', 'c'])
  })
})

describe('moveDatePatch', () => {
  it('moves only the date when the order stays valid', () => {
    expect(moveDatePatch({ startDate: '2026-10-01', dueDate: '2026-10-05' }, 'due', '2026-10-09')).toEqual({ dueDate: '2026-10-09' })
    expect(moveDatePatch({ startDate: '2026-10-01', dueDate: '2026-10-05' }, 'start', '2026-10-03')).toEqual({ startDate: '2026-10-03' })
    expect(moveDatePatch({ startDate: null, dueDate: null }, 'due', '2026-10-03')).toEqual({ dueDate: '2026-10-03' })
  })

  it('shifts the other date to keep the length when needed', () => {
    expect(moveDatePatch({ startDate: '2026-10-05', dueDate: '2026-10-08' }, 'due', '2026-10-02'))
      .toEqual({ dueDate: '2026-10-02', startDate: '2026-09-29' })
    expect(moveDatePatch({ startDate: '2026-10-05', dueDate: '2026-10-08' }, 'start', '2026-10-30'))
      .toEqual({ startDate: '2026-10-30', dueDate: '2026-11-02' })
    expect(moveDatePatch({ startDate: '2026-10-05', dueDate: null }, 'due', '2026-10-01')).toEqual({ dueDate: '2026-10-01', startDate: '2026-10-01' })
  })

  it('counts days across months', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3)
    expect(daysBetween('2026-11-02', '2026-10-30')).toBe(-3)
  })
})
