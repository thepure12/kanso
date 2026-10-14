import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import BoardCalendarView from '~/components/BoardCalendarView.vue'
import type { Card } from '#shared/types/board'

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, columnId: 'col', title: `Card ${id}`, description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const cards = [card('a', { dueDate: '2026-10-20', startDate: '2026-10-02' }), card('b')]
const mount = (canEdit = true) =>
  mountSuspended(BoardCalendarView, { props: { cards, tags: [], canEdit, today: '2026-10-14' } })

describe('BoardCalendarView', () => {
  it('places cards on their due date and lists undated ones in the tray', async () => {
    const w = await mount()
    expect(w.find('[data-date="2026-10-20"]').text()).toContain('Card a')
    expect(w.find('[data-date="2026-09-28"]').exists()).toBe(true)
    expect(w.find('[data-date="none"]').text()).toContain('Card b')
    expect(w.find('[data-date="none"]').text()).not.toContain('Card a')
  })

  it('moves between months and back to today', async () => {
    const w = await mount()
    await w.find('[aria-label="Next month"]').trigger('click')
    expect(w.find('[data-date="2026-11-30"]').exists()).toBe(true)
    expect(w.find('[data-card="a"]').exists()).toBe(false)
    await w.findAll('button').find(b => b.text() === 'Today')!.trigger('click')
    expect(w.find('[data-card="a"]').exists()).toBe(true)
  })

  it('opens a card on click', async () => {
    const w = await mount()
    await w.find('[data-card="a"]').trigger('click')
    expect(w.emitted('open')).toEqual([['a']])
  })

  it('drags a card to another day or to the tray', async () => {
    const w = await mount()
    await w.find('[data-card="a"]').trigger('dragstart')
    await w.find('[data-date="2026-10-23"]').trigger('dragover')
    await w.find('[data-date="2026-10-23"]').trigger('drop')
    await w.find('[data-card="a"]').trigger('dragstart')
    await w.find('[data-date="none"]').trigger('drop')
    await w.find('[data-card="b"]').trigger('dragstart')
    await w.find('[data-date="2026-10-01"]').trigger('drop')
    expect(w.emitted('set-date')!.map(([c, patch]) => [(c as Card).id, patch])).toEqual([
      ['a', { dueDate: '2026-10-23' }],
      ['a', { dueDate: null }],
      ['b', { dueDate: '2026-10-01' }],
    ])
    expect(w.emitted('dragging')![0]).toEqual([true])
  })

  it('does not let viewers drag', async () => {
    const w = await mount(false)
    expect(w.find('[data-card="a"]').attributes('draggable')).toBe('false')
  })
})
