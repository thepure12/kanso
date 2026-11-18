import { describe, expect, it } from 'vitest'
import { dueReminderDate, pendingReminders, reminderPresets, toLocalInput } from '../../app/utils/reminders'

describe('reminders', () => {
  it('formats datetime-local values', () => {
    expect(toLocalInput(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03')
  })

  it('offers an hour from now and tomorrow morning', () => {
    const { inOneHour, tomorrowMorning } = reminderPresets(new Date(2026, 11, 31, 22, 15, 42))
    expect(toLocalInput(inOneHour)).toBe('2026-12-31T23:15')
    expect(inOneHour.getSeconds()).toBe(0)
    expect(toLocalInput(tomorrowMorning)).toBe('2027-01-01T09:00')
  })

  it('places due-date reminders before the due date', () => {
    expect(toLocalInput(dueReminderDate('2026-03-01', 1, '09:30'))).toBe('2026-02-28T09:30')
    expect(toLocalInput(dueReminderDate('2026-03-01', 0, '18:00'))).toBe('2026-03-01T18:00')
  })

  it('keeps reminders not yet sent', () => {
    const base = { remindAt: null, beforeDueDays: 1, dueTime: '09:00', timeZone: 'UTC', note: null }
    expect(pendingReminders([{ ...base, id: 'a', sentAt: null }, { ...base, id: 'b', sentAt: '2026-01-01T00:00:00Z' }]).map(r => r.id)).toEqual(['a'])
  })
})
