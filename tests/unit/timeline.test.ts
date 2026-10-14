import { describe, expect, it } from 'vitest'
import { isScheduled, timelineBar, timelineMonths, timelineRange } from '../../app/utils/timeline'

describe('timeline', () => {
  it('spans today and all dates with padding, starting on a Monday', () => {
    const r = timelineRange([{ startDate: '2026-10-20', dueDate: '2026-11-03' }, { startDate: null, dueDate: '2026-10-25' }], '2026-10-14', 7)
    // 2026-10-07 is a Wednesday; back to Monday 10-05.
    expect(r.start).toBe('2026-10-05')
    expect(r.end).toBe('2026-11-10')
    expect(r.days).toBe(37)
  })

  it('places bars and one-day markers', () => {
    expect(timelineBar({ startDate: '2026-10-07', dueDate: '2026-10-09' }, '2026-10-05')).toEqual({ offset: 2, length: 3, marker: false })
    expect(timelineBar({ startDate: null, dueDate: '2026-10-05' }, '2026-10-05')).toEqual({ offset: 0, length: 1, marker: true })
    expect(timelineBar({ startDate: '2026-10-06', dueDate: null }, '2026-10-05')).toEqual({ offset: 1, length: 1, marker: true })
    expect(timelineBar({ startDate: null, dueDate: null }, '2026-10-05')).toBeNull()
    expect(isScheduled({ startDate: null, dueDate: null })).toBe(false)
  })

  it('splits the header into months', () => {
    const months = timelineMonths('2026-10-26', 14, 'en-GB')
    expect(months.map(m => [m.offset, m.length])).toEqual([[0, 6], [6, 8]])
    expect(months[1]!.label).toBe('Nov 2026')
  })
})
