import { describe, expect, it } from 'vitest'
import type { MyWorkCard } from '#shared/types/myWork'
import { filterMyWork, groupMyWork } from '../../app/utils/myWork'

const today = '2026-10-13'
const card = (id: string, over: Partial<MyWorkCard> = {}): MyWorkCard => ({
  id, title: id, boardId: 'b', boardName: 'Board', columnId: 'col', columnTitle: 'Todo', startDate: null, dueDate: null,
  priority: null, estimate: null, assigned: true, watching: false, done: false, ...over,
})

describe('groupMyWork', () => {
  it('buckets by due date in display order and drops empty buckets', () => {
    const cards = [
      card('yesterday', { dueDate: '2026-10-12' }), card('today', { dueDate: today }), card('week', { dueDate: '2026-10-20' }),
      card('later', { dueDate: '2026-10-21' }), card('none'), card('also-overdue', { dueDate: '2025-01-01' }),
    ]
    expect(groupMyWork(cards, today).map(g => [g.bucket, g.cards.map(c => c.id)])).toEqual([
      ['overdue', ['yesterday', 'also-overdue']], ['today', ['today']], ['soon', ['week']], ['later', ['later']], ['none', ['none']],
    ])
    expect(groupMyWork([card('none')], today).map(g => g.bucket)).toEqual(['none'])
    expect(groupMyWork([], today)).toEqual([])
  })
})

describe('filterMyWork', () => {
  const cards = [
    card('mine'), card('watched', { assigned: false, watching: true }), card('both', { watching: true }), card('done', { done: true }),
  ]
  const ids = (scope: 'all' | 'assigned' | 'watching', showDone = false) => filterMyWork(cards, { scope, showDone }).map(c => c.id)

  it('filters by scope and hides done cards unless asked', () => {
    expect(ids('all')).toEqual(['mine', 'watched', 'both'])
    expect(ids('assigned')).toEqual(['mine', 'both'])
    expect(ids('watching')).toEqual(['watched', 'both'])
    expect(ids('all', true)).toEqual(['mine', 'watched', 'both', 'done'])
  })
})
