import { describe, expect, it } from 'vitest'
import { mentionQuery, mentionToken } from '../../app/utils/mentions'

const id = '0b5b6c1e-6f43-4d0e-9a51-7d1f1c3c2a10'

describe('mentions', () => {
  it('builds tokens without characters that would break them', () => {
    expect(mentionToken({ userId: id, name: 'Ann [admin] (x)' })).toBe(`@[Ann admin x](user:${id})`)
  })

  it('finds the @query before the caret', () => {
    expect(mentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('mail a@b.c', 10)).toBeNull()
    expect(mentionQuery('hi @an more', 11)).toBeNull()
  })
})
