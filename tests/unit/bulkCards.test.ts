import { describe, expect, it } from 'vitest'
import { bulkInverse, bulkLabel } from '../../app/utils/bulkCards'

const card = (id: string, over: { tagIds?: string[], assigneeIds?: string[], priority?: 'high' | 'low' | null, dueDate?: string | null } = {}) =>
  ({ id, tagIds: [], assigneeIds: [], priority: null, dueDate: null, ...over })

describe('bulkInverse', () => {
  it('removes added tags and assignees only where they were new', () => {
    const cards = [card('a', { tagIds: ['t'] }), card('b'), card('c', { assigneeIds: ['u'] })]
    expect(bulkInverse(cards, { addTagIds: ['t'], addAssigneeIds: ['u'] })).toEqual([
      { cardIds: ['b', 'c'], removeTagIds: ['t'] },
      { cardIds: ['a', 'b'], removeAssigneeIds: ['u'] },
    ])
  })

  it('adds removed tags and assignees back only where they were', () => {
    const cards = [card('a', { tagIds: ['t', 's'] }), card('b', { tagIds: ['s'] })]
    expect(bulkInverse(cards, { removeTagIds: ['t', 's', 'gone'] })).toEqual([
      { cardIds: ['a'], addTagIds: ['t'] },
      { cardIds: ['a', 'b'], addTagIds: ['s'] },
    ])
    expect(bulkInverse([card('a', { assigneeIds: ['u'] })], { removeAssigneeIds: ['u'] })).toEqual([{ cardIds: ['a'], addAssigneeIds: ['u'] }])
  })

  it('restores priority and due date grouped by old value, skipping unchanged cards', () => {
    const cards = [card('a', { priority: 'low' }), card('b'), card('c', { priority: 'low' }), card('d', { priority: 'high' })]
    expect(bulkInverse(cards, { priority: 'high' })).toEqual([
      { cardIds: ['a', 'c'], priority: 'low' },
      { cardIds: ['b'], priority: null },
    ])
    expect(bulkInverse([card('a', { dueDate: '2026-01-01' }), card('b')], { dueDate: null })).toEqual([{ cardIds: ['a'], dueDate: '2026-01-01' }])
  })

  it('leaves moves and archiving to the caller', () => {
    expect(bulkInverse([card('a')], { columnId: 'col', archived: true })).toEqual([])
  })
})

describe('bulkLabel', () => {
  it('names the action', () => {
    expect(bulkLabel({ columnId: 'c' })).toBe('board.bulk.done.moved')
    expect(bulkLabel({ archived: false })).toBe('board.bulk.done.restored')
    expect(bulkLabel({ removeTagIds: ['t'] })).toBe('board.bulk.done.tags')
    expect(bulkLabel({ dueDate: null })).toBe('board.bulk.done.dueDate')
  })
})
