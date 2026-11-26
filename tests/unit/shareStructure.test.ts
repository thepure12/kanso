import { describe, expect, it } from 'vitest'
import { sameItems, shareStructure } from '../../app/utils/shareStructure'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('shareStructure', () => {
  const prev = {
    name: 'Board',
    tags: [{ id: 't1', name: 'Bug' }, { id: 't2', name: 'UI' }],
    members: [{ userId: 'u1', name: 'Ann' }],
    cards: [
      { id: 'c1', title: 'One', tagIds: ['t1'] },
      { id: 'c2', title: 'Two', tagIds: [] },
      { id: 'c3', title: 'Three', tagIds: ['t2'] },
    ],
  }

  it('returns prev itself when nothing changed', () => {
    expect(shareStructure(prev, clone(prev))).toBe(prev)
  })

  it('keeps unchanged cards and lists, replaces only what changed', () => {
    const next = clone(prev)
    next.cards[1]!.title = 'Two (edited)'
    const out = shareStructure(prev, next)
    expect(out).not.toBe(prev)
    expect(out).toEqual(next)
    expect(out.tags).toBe(prev.tags)
    expect(out.members).toBe(prev.members)
    expect(out.cards[0]).toBe(prev.cards[0])
    expect(out.cards[1]).not.toBe(prev.cards[1])
    expect(out.cards[2]).toBe(prev.cards[2])
  })

  it('matches items by id when they move, are added or removed', () => {
    const next = clone(prev)
    next.cards = [next.cards[2]!, { id: 'c4', title: 'Four', tagIds: [] }, next.cards[0]!]
    const out = shareStructure(prev, next)
    expect(out.cards[0]).toBe(prev.cards[2])
    expect(out.cards[2]).toBe(prev.cards[0])
    expect(out.cards[1]).toEqual({ id: 'c4', title: 'Four', tagIds: [] })
    expect(out.cards).not.toBe(prev.cards)
  })

  it('notices added and removed keys', () => {
    const withKey = { ...clone(prev.cards[0]!), dueDate: '2026-12-01' }
    expect(shareStructure(prev.cards[0], withKey)).toEqual(withKey)
    expect(shareStructure(withKey, clone(prev.cards[0]!))).toEqual(prev.cards[0])
  })

  it('takes next when there is no prev', () => {
    const next = clone(prev)
    expect(shareStructure(undefined, next)).toBe(next)
  })

  it('sameItems compares identity and order', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    expect(sameItems([a, b], [a, b])).toBe(true)
    expect(sameItems([a, b], [b, a])).toBe(false)
    expect(sameItems([a], [{ id: 'a' }])).toBe(false)
  })
})
