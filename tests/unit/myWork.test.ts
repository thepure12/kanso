import { describe, expect, it } from 'vitest'
import type { MyWorkCard } from '#shared/types/myWork'
import { emptyMyWorkPanelConfig, myWorkPanelConfigSchema, myWorkQuery } from '#shared/myWork'
import { filterMyWork, filterPanelCards, groupMyWork, myWorkDueDate } from '../../app/utils/myWork'

const today = '2026-10-13'
const card = (id: string, over: Partial<MyWorkCard> = {}): MyWorkCard => ({
  id, title: id, boardId: 'b', boardName: 'Board', columnId: 'col', columnTitle: 'Todo', startDate: null, dueDate: null,
  priority: null, estimate: null, assigned: true, watching: false, done: false, checklistItems: [], assignees: [], ...over,
})

describe('groupMyWork', () => {
  it('buckets by due date in display order and drops empty buckets', () => {
    const cards = [
      card('yesterday', { dueDate: '2026-10-12' }), card('today', { dueDate: today }), card('week', { dueDate: '2026-10-20' }),
      card('later', { dueDate: '2026-10-21' }), card('none'), card('also-overdue', { dueDate: '2025-01-01' }),
    ]
    expect(groupMyWork(cards, today).map(g => [g.bucket, g.cards.map(c => c.id)])).toEqual([
      ['overdue', ['also-overdue', 'yesterday']], ['today', ['today']], ['soon', ['week']], ['later', ['later']], ['none', ['none']],
    ])
    expect(groupMyWork([card('none')], today).map(g => g.bucket)).toEqual(['none'])
    expect(groupMyWork([], today)).toEqual([])
  })

  it('uses the earliest due date of the card and its assigned checklist items', () => {
    const item = (dueDate: string | null) => ({ id: `i${dueDate}`, text: 'x', dueDate })
    const viaItem = card('item', { assigned: false, dueDate: '2026-11-30', checklistItems: [item(null), item(today)] })
    expect(myWorkDueDate(viaItem)).toBe(today)
    expect(myWorkDueDate(card('none', { checklistItems: [item(null)] }))).toBeNull()
    const cards = [card('week', { dueDate: '2026-10-20' }), card('sooner', { checklistItems: [item('2026-10-15')] }), viaItem]
    expect(groupMyWork(cards, today).map(g => [g.bucket, g.cards.map(c => c.id)])).toEqual([
      ['today', ['item']], ['soon', ['sooner', 'week']],
    ])
  })
})

describe('filterMyWork', () => {
  const cards = [
    card('mine'), card('watched', { assigned: false, watching: true }), card('both', { watching: true }), card('done', { done: true }),
    card('item', { assigned: false, checklistItems: [{ id: 'i', text: 'x', dueDate: null }] }),
  ]
  const ids = (scope: 'all' | 'assigned' | 'watching', showDone = false) => filterMyWork(cards, { scope, showDone }).map(c => c.id)

  it('filters by scope and hides done cards unless asked', () => {
    expect(ids('all')).toEqual(['mine', 'watched', 'both', 'item'])
    expect(ids('assigned')).toEqual(['mine', 'both', 'item'])
    expect(ids('watching')).toEqual(['watched', 'both'])
    expect(ids('all', true)).toEqual(['mine', 'watched', 'both', 'done', 'item'])
  })
})

describe('My work panels', () => {
  it('filters due buckets and done cards in the browser', () => {
    const cards = [card('overdue', { dueDate: '2026-10-01' }), card('none'), card('done', { done: true }), card('today', { dueDate: today })]
    const ids = (due: ('overdue' | 'today' | 'none')[], showDone: boolean) => filterPanelCards(cards, { due, showDone }, today).map(c => c.id)
    expect(ids([], false)).toEqual(['overdue', 'none', 'today'])
    expect(ids([], true)).toEqual(['overdue', 'none', 'done', 'today'])
    expect(ids(['overdue', 'today'], false)).toEqual(['overdue', 'today'])
    expect(ids(['none'], true)).toEqual(['none', 'done'])
  })

  it('turns a panel into the my-work query, leaving out empty choices', () => {
    expect(myWorkQuery(emptyMyWorkPanelConfig())).toEqual({ people: 'assigned' })
    const id = '6f9619ff-8b86-4011-b42d-00c04fc964ff'
    expect(myWorkQuery({
      ...emptyMyWorkPanelConfig(), people: 'people', userIds: [id], columns: ['To do'], boardIds: [id], tags: ['UI'], priorities: ['high', 'none'], due: ['overdue'],
    })).toEqual({ people: 'people', user: [id], column: ['To do'], board: [id], tag: ['UI'], priority: ['high', 'none'] })
    // userIds only count for chosen people.
    expect(myWorkQuery({ ...emptyMyWorkPanelConfig(), people: 'anyone', userIds: [id] })).toEqual({ people: 'anyone' })
  })

  it('validates the stored config', () => {
    expect(myWorkPanelConfigSchema.safeParse(emptyMyWorkPanelConfig()).success).toBe(true)
    expect(myWorkPanelConfigSchema.safeParse({ ...emptyMyWorkPanelConfig(), people: 'everyone' }).success).toBe(false)
    expect(myWorkPanelConfigSchema.safeParse({ ...emptyMyWorkPanelConfig(), due: ['tomorrow'] }).success).toBe(false)
  })
})
