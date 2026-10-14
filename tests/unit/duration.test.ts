import { describe, expect, it } from 'vitest'
import { formatDuration, parseDuration } from '../../app/utils/duration'
import { serverI18n } from '../../server/utils/i18n'

const { t } = serverI18n('en')

describe('parseDuration', () => {
  it('reads hours and minutes in several forms', () => {
    expect(parseDuration('1h30m')).toBe(90)
    expect(parseDuration(' 1h 30m ')).toBe(90)
    expect(parseDuration('1h30')).toBe(90)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('2 hours')).toBe(120)
    expect(parseDuration('45m')).toBe(45)
    expect(parseDuration('45 min')).toBe(45)
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('1.5h')).toBe(90)
    expect(parseDuration('1:05')).toBe(65)
    expect(parseDuration('1H15M')).toBe(75)
  })

  it('rejects empty, zero and malformed input', () => {
    for (const s of ['', '  ', '0', '0h', 'h', 'm', 'abc', '1:75', '-1h', '1d', '1.5m']) {
      expect(parseDuration(s), s).toBeNull()
    }
  })
})

describe('formatDuration', () => {
  it('formats minutes', () => {
    expect(formatDuration(45, t)).toBe('45m')
    expect(formatDuration(60, t)).toBe('1h')
    expect(formatDuration(90, t)).toBe('1h 30m')
    expect(formatDuration(1500, t)).toBe('25h')
  })
})
