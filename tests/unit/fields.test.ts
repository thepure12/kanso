import { describe, expect, it } from 'vitest'
import type { BoardField } from '#shared/types/board'
import { isValidFieldValue } from '#shared/fields'
import { fieldFilterKey, formatFieldValue, urlHost } from '../../app/utils/fields'
import { serverI18n } from '../../server/utils/i18n'

const en = serverI18n('en')

const field = (kind: BoardField['kind']) => ({
  kind, options: kind === 'select' ? [{ id: 's', label: 'Small', color: '#22c55e' }] : [],
})

describe('isValidFieldValue', () => {
  it('matches the database checks per kind', () => {
    const cases: [BoardField['kind'], unknown[], unknown[]][] = [
      ['text', ['x'], ['', 5, true, 'x'.repeat(2001)]],
      ['number', [0, -1.5], ['1', Number.NaN, Infinity]],
      ['date', ['2026-02-28', '2028-02-29'], ['2026-02-30', '2026-2-1', 20260228]],
      ['select', ['s'], ['m', 'Small']],
      ['checkbox', [true, false], ['true', 0]],
      ['url', ['https://example.com/a?b', 'HTTP://x.y'], ['ftp://x.y', 'javascript:alert(1)', 'https://', 'https://a b']],
    ]
    for (const [kind, good, bad] of cases) {
      for (const v of good) expect(isValidFieldValue(field(kind), v), `${kind} ${v}`).toBe(true)
      for (const v of bad) expect(isValidFieldValue(field(kind), v), `${kind} ${v}`).toBe(false)
    }
  })
})

describe('formatFieldValue', () => {
  it('formats each kind', () => {
    expect(formatFieldValue(field('select'), 's', en)).toBe('Small')
    expect(formatFieldValue(field('select'), 'gone', en)).toBeNull()
    expect(formatFieldValue(field('checkbox'), true, en)).toBe('Yes')
    expect(formatFieldValue(field('checkbox'), false, en)).toBe('No')
    expect(formatFieldValue(field('url'), 'https://www.example.com/x', en)).toBe('example.com')
    expect(formatFieldValue(field('text'), 'hello', en)).toBe('hello')
    expect(formatFieldValue(field('number'), 1.5, en)).toBe('1.5')
    expect(formatFieldValue(field('date'), `${new Date().getFullYear()}-03-12`, en)).toMatch(/12/)
    expect(formatFieldValue(field('text'), undefined, en)).toBeNull()
    expect(formatFieldValue(field('checkbox'), true, serverI18n('de'))).toBe('Ja')
    expect(formatFieldValue(field('number'), 1.5, serverI18n('de'))).toBe('1,5')
  })

  it('urlHost falls back to the input', () => {
    expect(urlHost('not a url')).toBe('not a url')
  })

  it('fieldFilterKey treats missing and unticked as none', () => {
    expect(fieldFilterKey(undefined)).toBe('none')
    expect(fieldFilterKey(false)).toBe('none')
    expect(fieldFilterKey(true)).toBe('true')
    expect(fieldFilterKey('s')).toBe('s')
  })
})
