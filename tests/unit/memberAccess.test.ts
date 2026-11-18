import { describe, expect, it } from 'vitest'
import { cardAccess, columnAccess } from '../../app/utils/memberAccess'

const limits = { defaultAccess: 'none' as const, columns: { a: 'edit' as const, b: 'read' as const }, cards: { x: 'edit' as const, y: 'none' as const } }

describe('member access', () => {
  it('follows card, then column, then default', () => {
    expect(cardAccess(limits, 'editor', { id: 'x', columnId: 'c' })).toBe('edit')
    expect(cardAccess(limits, 'editor', { id: 'y', columnId: 'a' })).toBe('none')
    expect(cardAccess(limits, 'editor', { id: 'z', columnId: 'b' })).toBe('read')
    expect(cardAccess(limits, 'editor', { id: 'z', columnId: 'c' })).toBe('none')
    expect(columnAccess(limits, 'editor', 'a')).toBe('edit')
  })

  it('caps viewers at read and ignores limits without them or for owners', () => {
    expect(cardAccess(limits, 'viewer', { id: 'x', columnId: 'c' })).toBe('read')
    expect(cardAccess(null, 'viewer', { id: 'x', columnId: 'c' })).toBe('read')
    expect(cardAccess(null, 'editor', { id: 'x', columnId: 'c' })).toBe('edit')
    expect(columnAccess(limits, 'owner', 'zzz')).toBe('edit')
  })

  it('caps commenters at read like viewers', () => {
    expect(cardAccess(limits, 'commenter', { id: 'x', columnId: 'c' })).toBe('read')
    expect(cardAccess(limits, 'commenter', { id: 'y', columnId: 'a' })).toBe('none')
    expect(cardAccess(null, 'commenter', { id: 'x', columnId: 'c' })).toBe('read')
  })
})
