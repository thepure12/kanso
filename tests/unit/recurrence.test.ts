import { describe, expect, it } from 'vitest'
import { describeRecurrence, recurrenceInput } from '../../app/utils/recurrence'
import { serverI18n } from '../../server/utils/i18n'

const en = serverI18n('en')

describe('describeRecurrence', () => {
  it('names the interval and days', () => {
    expect(describeRecurrence({ rule: 'daily', interval: 1, weekdays: null, dayOfMonth: null }, en)).toBe('Every day')
    expect(describeRecurrence({ rule: 'daily', interval: 3, weekdays: null, dayOfMonth: null }, en)).toBe('Every 3 days')
    expect(describeRecurrence({ rule: 'weekly', interval: 2, weekdays: [5, 1], dayOfMonth: null }, en)).toBe('Every 2 weeks on Mon, Fri')
    expect(describeRecurrence({ rule: 'monthly', interval: 1, weekdays: null, dayOfMonth: 2 }, en)).toBe('Every month on the 2nd')
    expect(describeRecurrence({ rule: 'monthly', interval: 1, weekdays: null, dayOfMonth: 11 }, en)).toBe('Every month on the 11th')
    expect(describeRecurrence({ rule: 'monthly', interval: 6, weekdays: null, dayOfMonth: 31 }, en)).toBe('Every 6 months on the 31st (or the last day)')
    expect(describeRecurrence({ rule: 'weekly', interval: 1, weekdays: [1], dayOfMonth: null }, serverI18n('de'))).toMatch(/^Jede Woche/)
  })
})

describe('recurrenceInput', () => {
  const base = { columnId: 'c', interval: 1, weekdays: [3, 1, 3], dayOfMonth: 15, dueInDays: null, active: true }

  it('keeps only the fields of the rule', () => {
    expect(recurrenceInput({ ...base, rule: 'daily' })).toMatchObject({ weekdays: null, dayOfMonth: null })
    expect(recurrenceInput({ ...base, rule: 'weekly' })).toMatchObject({ weekdays: [1, 3], dayOfMonth: null })
    expect(recurrenceInput({ ...base, rule: 'monthly' })).toMatchObject({ weekdays: null, dayOfMonth: 15 })
  })

  it('rejects incomplete or out of range input', () => {
    expect(recurrenceInput({ ...base, rule: 'weekly', weekdays: [] })).toBeNull()
    expect(recurrenceInput({ ...base, rule: 'monthly', dayOfMonth: null })).toBeNull()
    expect(recurrenceInput({ ...base, rule: 'monthly', dayOfMonth: 32 })).toBeNull()
    expect(recurrenceInput({ ...base, rule: 'daily', interval: 0 })).toBeNull()
    expect(recurrenceInput({ ...base, rule: 'daily', dueInDays: 1.5 })).toBeNull()
  })
})
