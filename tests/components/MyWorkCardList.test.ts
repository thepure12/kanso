import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { MyWorkCard } from '#shared/types/myWork'
import MyWorkCardList from '~/components/MyWorkCardList.vue'

const card = (id: string, over: Partial<MyWorkCard> = {}): MyWorkCard => ({
  id, title: `Card ${id}`, boardId: 'b1', boardName: 'Board one', columnId: 'col', columnTitle: 'To do', startDate: null, dueDate: null,
  priority: null, estimate: null, assigned: true, watching: false, done: false, completed: false, checklistItems: [], assignees: [], tags: [], ...over,
})

describe('MyWorkCardList', () => {
  it('groups cards, shows tags and emits complete', async () => {
    const cards = [
      card('1', { dueDate: '2026-10-01', tags: [{ id: 't', name: 'Backend', color: '#112233' }] }),
      card('2', { done: true, completed: true }),
      card('3', { done: true, boardId: 'b2', boardName: 'Board two' }),
    ]
    const w = await mountSuspended(MyWorkCardList, { props: { cards, today: '2026-10-13' } })
    expect(w.text()).toContain('Overdue')
    expect(w.text()).toContain('No due date')
    expect(w.text()).toContain('Backend')
    expect(w.text()).toContain('Board one')

    await w.find('button[aria-label="Mark complete: Card 1"]').trigger('click')
    await w.find('button[aria-label="Open again: Card 2"]').trigger('click')
    expect(w.emitted('complete')!.map(([c, done]) => [(c as MyWorkCard).id, done])).toEqual([['1', true], ['2', false]])
    // Done by its column, not marked complete: nothing to toggle.
    expect(w.find('button[aria-label="Mark complete: Card 3"]').attributes('disabled')).toBeDefined()

    await w.setProps({ groupBy: 'board' })
    const headings = w.findAll('h3').map(h => h.text())
    expect(headings[0]).toContain('Board one')
    expect(headings[1]).toContain('Board two')
  })
})
