import { describe, expect, it } from 'vitest'
import { toPrefixTsquery } from '../../server/utils/search'

describe('toPrefixTsquery', () => {
  it('ANDs a prefix term per word, lower-cased and deduplicated', () => {
    expect(toPrefixTsquery('Desi  REV desi')).toBe('desi:* & rev:*')
  })

  it('keeps letters and digits in any script and drops tsquery syntax', () => {
    expect(toPrefixTsquery('Über-Größe v2')).toBe('über:* & größe:* & v2:*')
    expect(toPrefixTsquery(`a' | !b:* & (c)`)).toBe('a:* & b:* & c:*')
  })

  it('returns null without words', () => {
    expect(toPrefixTsquery('  !?- ')).toBeNull()
    expect(toPrefixTsquery('')).toBeNull()
  })
})
