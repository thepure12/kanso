import { describe, expect, it } from 'vitest'
import { snoozePresets } from '../../app/utils/snooze'

describe('snoozePresets', () => {
  it('offers tomorrow, next Monday and the same day next month', () => {
    // 2026-11-18 is a Wednesday.
    expect(snoozePresets('2026-11-18')).toEqual({ tomorrow: '2026-11-19', nextWeek: '2026-11-23', nextMonth: '2026-12-18' })
  })

  it('goes a full week on from a Monday and over the year end', () => {
    expect(snoozePresets('2026-12-28')).toEqual({ tomorrow: '2026-12-29', nextWeek: '2027-01-04', nextMonth: '2027-01-28' })
  })

  it('clamps to the end of a shorter month', () => {
    expect(snoozePresets('2027-01-31').nextMonth).toBe('2027-02-28')
    expect(snoozePresets('2028-01-31').nextMonth).toBe('2028-02-29')
  })

  it('counts Sunday to the next day', () => {
    expect(snoozePresets('2026-11-22').nextWeek).toBe('2026-11-23')
  })
})
