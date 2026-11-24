import { describe, expect, it } from 'vitest'
import { bulkInverse, bulkLabel, gatherGroup, savedNeighbours } from '../../app/utils/bulkCards'

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

describe('gatherGroup', () => {
  it('gathers the selected cards around the dropped one in board order', () => {
    // b was dragged from "a" to between x and y; a1 and c1 are selected with it.
    const lists = { a: ['a1', 'a2'], b: ['x', 'b', 'y'], c: ['c1', 'c2'] }
    expect(gatherGroup(lists, 'b', 'b', ['a1', 'b', 'c1'])).toEqual({ a: ['a2'], b: ['x', 'a1', 'b', 'c1', 'y'], c: ['c2'] })
  })

  it('reorders within one column', () => {
    const lists = { a: ['b', 'c', 'a', 'd'] }
    expect(gatherGroup(lists, 'a', 'a', ['a', 'c'])).toEqual({ a: ['b', 'a', 'c', 'd'] })
  })

  it('leaves the lists alone when the dragged card is not in the column', () => {
    const lists = { a: ['a'] }
    expect(gatherGroup(lists, 'b', 'a', ['a'])).toBe(lists)
  })
})

describe('savedNeighbours', () => {
  it('skips cards not saved in the column yet', () => {
    const ids = ['x', 'a', 'b', 'c', 'y']
    expect(savedNeighbours(ids, 1, new Set(['b', 'c']))).toEqual({ aboveId: 'x', belowId: 'y' })
    expect(savedNeighbours(ids, 2, new Set(['c']))).toEqual({ aboveId: 'a', belowId: 'y' })
    expect(savedNeighbours(['a'], 0, new Set())).toEqual({ aboveId: null, belowId: null })
  })
})
