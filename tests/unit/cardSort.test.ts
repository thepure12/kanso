import { describe, expect, it } from 'vitest'
import type { BoardField, Card } from '#shared/types/board'
import { restoreOrder, sortByPriority, sortCards } from '../../app/utils/cardSort'

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, columnId: 'c1', title: id, description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const fields: BoardField[] = [
  { id: 'n', name: 'Amount', kind: 'number', options: [], position: 1, showOnCard: true },
  { id: 's', name: 'Size', kind: 'select', options: [{ id: 'l', label: 'Large', color: '#000000' }, { id: 'a', label: 'A small', color: '#000000' }], position: 2, showOnCard: true },
]
const ctx = {
  columns: [{ id: 'c1' }, { id: 'c2' }],
  members: [{ userId: 'u1', name: 'Zed' }, { userId: 'u2', name: 'Amy' }],
  tags: [{ id: 't1', name: 'bug' }],
  fields,
}
const ids = (cards: Card[]) => cards.map(c => c.id)

describe('sortCards', () => {
  it('keeps board order without a sort', () => {
    const cards = [card('b'), card('a')]
    expect(ids(sortCards(cards, null, ctx))).toEqual(['b', 'a'])
  })

  it('sorts titles naturally both ways', () => {
    const cards = [card('Task 10'), card('task 2'), card('Task 1')]
    expect(ids(sortCards(cards, { key: 'title', desc: false }, ctx))).toEqual(['Task 1', 'task 2', 'Task 10'])
    expect(ids(sortCards(cards, { key: 'title', desc: true }, ctx))).toEqual(['Task 10', 'task 2', 'Task 1'])
  })

  it('puts empty values last in either direction', () => {
    const cards = [card('x'), card('a', { dueDate: '2026-10-02' }), card('b', { dueDate: '2026-10-01' })]
    expect(ids(sortCards(cards, { key: 'due', desc: false }, ctx))).toEqual(['b', 'a', 'x'])
    expect(ids(sortCards(cards, { key: 'due', desc: true }, ctx))).toEqual(['a', 'b', 'x'])
  })

  it('sorts priority urgent first, columns in board order, assignees by name', () => {
    const cards = [card('low', { priority: 'low', columnId: 'c2', assigneeIds: ['u1'] }), card('urgent', { priority: 'urgent', assigneeIds: ['u2', 'u1'] })]
    expect(ids(sortCards(cards, { key: 'priority', desc: false }, ctx))).toEqual(['urgent', 'low'])
    expect(ids(sortCards(cards, { key: 'column', desc: true }, ctx))).toEqual(['low', 'urgent'])
    expect(ids(sortCards(cards, { key: 'assignees', desc: false }, ctx))).toEqual(['urgent', 'low'])
  })

  it('sorts numbers and select options in option order', () => {
    const cards = [card('a', { fields: { n: 10, s: 'a' } }), card('b', { fields: { n: -1, s: 'l' } }), card('c')]
    expect(ids(sortCards(cards, { key: 'field:n', desc: false }, ctx))).toEqual(['b', 'a', 'c'])
    expect(ids(sortCards(cards, { key: 'field:s', desc: false }, ctx))).toEqual(['b', 'a', 'c'])
  })
})

describe('sortByPriority', () => {
  it('puts urgent first and cards without a priority last, keeping ties in order', () => {
    const cards = [card('n1'), card('l', { priority: 'low' }), card('u1', { priority: 'urgent' }), card('n2'), card('u2', { priority: 'urgent' }), card('h', { priority: 'high' })]
    expect(ids(sortByPriority(cards))).toEqual(['u1', 'u2', 'h', 'l', 'n1', 'n2'])
  })
})

describe('restoreOrder', () => {
  it('puts known ids back in their old order and new ones at the end', () => {
    expect(restoreOrder(['c', 'a', 'x', 'b', 'y'], ['a', 'b', 'gone', 'c'])).toEqual(['a', 'b', 'c', 'x', 'y'])
  })
})
