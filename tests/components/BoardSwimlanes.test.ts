import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { VueDraggable } from 'vue-draggable-plus'
import BoardSwimlanes from '~/components/BoardSwimlanes.vue'
import type { Card, Column } from '#shared/types/board'

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, columnId: 'c1', title: `Card ${id}`, description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const columns: Column[] = [
  { id: 'c1', title: 'To do', position: 1, color: null, wipLimit: null, rules: [] },
  { id: 'c2', title: 'Done', position: 2, color: null, wipLimit: null, rules: [] },
]

describe('BoardSwimlanes', () => {
  it('moves a card dropped on a collapsed column to its end, taking the lane', async () => {
    const lists = { c1: [card('a', { priority: 'high' })], c2: [card('b', { columnId: 'c2', priority: 'low' }), card('c', { columnId: 'c2', priority: 'low' })] }
    const w = await mountSuspended(BoardSwimlanes, {
      props: {
        groupBy: 'priority', columns, columnWidth: () => 288, collapsed: (id: string) => id === 'c2', lists,
        tags: [], fields: [], members: [], visibleIds: new Set(['a', 'b', 'c']), blockedIds: new Set(),
        canEdit: true, dragDisabled: false, today: '2026-11-20',
      },
    })
    const target = w.findAllComponents(VueDraggable).find(d => d.attributes('data-collapsed-column') === 'c2' && d.attributes('data-lane') === 'low')!
    expect(target).toBeTruthy()
    const item = document.createElement('div')
    item.dataset.cardId = 'a'
    target.vm.$emit('add', { item })
    await new Promise(r => setTimeout(r))
    expect(w.emitted('move')).toEqual([[lists.c1[0], 'c2', 2, 'low']])
  })
})
