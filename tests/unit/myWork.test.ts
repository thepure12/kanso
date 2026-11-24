import { describe, expect, it } from 'vitest'
import type { MyWorkCard } from '#shared/types/myWork'
import { emptyMyWorkPanelConfig, myWorkPanelConfigSchema, myWorkQuery } from '#shared/myWork'
import { filterMyWork, filterPanelCards, groupMyWork, groupMyWorkBy, myWorkDueDate, myWorkSummary, searchMyWork, withCompleted } from '../../app/utils/myWork'

const today = '2026-10-13'
const card = (id: string, over: Partial<MyWorkCard> = {}): MyWorkCard => ({
  id, title: id, boardId: 'b', boardName: 'Board', columnId: 'col', columnTitle: 'Todo', startDate: null, dueDate: null,
  priority: null, estimate: null, assigned: true, watching: false, done: false, completed: false, checklistItems: [], assignees: [], tags: [], ...over,
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

describe('My work makeover helpers', () => {
  it('groups by board, boards by name and cards by due date', () => {
    const cards = [
      card('b-none', { boardId: 'b2', boardName: 'beta' }), card('a-late', { boardId: 'b1', boardName: 'Alpha', dueDate: '2026-12-01' }),
      card('b-soon', { boardId: 'b2', boardName: 'beta', dueDate: '2026-10-14' }), card('a-soon', { boardId: 'b1', boardName: 'Alpha', dueDate: '2026-10-14' }),
    ]
    expect(groupMyWorkBy(cards, 'board', today).map(g => [g.board?.name, g.cards.map(c => c.id)])).toEqual([
      ['Alpha', ['a-soon', 'a-late']], ['beta', ['b-soon', 'b-none']],
    ])
    expect(groupMyWorkBy(cards, 'due', today).map(g => g.key)).toEqual(['soon', 'later', 'none'])
  })

  it('searches title, board, column, tags and checklist items by every word', () => {
    const cards = [
      card('fix login', { boardName: 'Web' }), card('other', { columnTitle: 'Review', tags: [{ id: 't', name: 'Backend', color: '#000' }] }),
      card('third', { checklistItems: [{ id: 'i', text: 'Write docs', dueDate: null }] }),
    ]
    const ids = (q: string) => searchMyWork(cards, q).map(c => c.id)
    expect(ids('  ')).toEqual(['fix login', 'other', 'third'])
    expect(ids('LOGIN web')).toEqual(['fix login'])
    expect(ids('backend review')).toEqual(['other'])
    expect(ids('docs')).toEqual(['third'])
    expect(ids('login docs')).toEqual([])
  })

  it('counts open cards per due bucket', () => {
    const cards = [card('o', { dueDate: '2026-10-01' }), card('t', { dueDate: today }), card('d', { done: true, dueDate: today }), card('n')]
    expect(myWorkSummary(cards, today)).toEqual({ open: 3, overdue: 1, today: 1, soon: 0, later: 0, none: 1 })
  })

  it('marks cards complete and open again locally', () => {
    const cards = [card('a'), card('last-column', { done: true })]
    const completed = withCompleted(cards, 'a', true)
    expect(completed[0]).toMatchObject({ completed: true, done: true })
    expect(withCompleted(completed, 'a', false)[0]).toMatchObject({ completed: false, done: false })
    expect(withCompleted(cards, 'last-column', true)[1]).toMatchObject({ completed: true, done: true })
    expect(withCompleted(withCompleted(cards, 'last-column', true), 'last-column', false)[1]).toMatchObject({ completed: false, done: false })
  })
})
