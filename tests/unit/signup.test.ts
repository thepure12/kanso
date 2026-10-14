import { describe, expect, it } from 'vitest'
import { isDomain, normalizeDomain, parseList } from '../../shared/signup'

describe('sign-up settings helpers', () => {
  it('splits lists on commas, spaces and newlines, lower-cased', () => {
    expect(parseList(' Ana@Example.org ,\nbo@x.test  c@y.test,,')).toEqual(['ana@example.org', 'bo@x.test', 'c@y.test'])
    expect(parseList('  ')).toEqual([])
  })

  it('normalizes and validates domains', () => {
    expect(normalizeDomain(' @Corp.Example ')).toBe('corp.example')
    expect(isDomain('corp.example')).toBe(true)
    expect(isDomain('sub.corp-1.example')).toBe(true)
    expect(isDomain('localhost')).toBe(false)
    expect(isDomain('not a domain')).toBe(false)
    expect(isDomain('-bad.example')).toBe(false)
  })
})
