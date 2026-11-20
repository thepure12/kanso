import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import CardChecklist from '~/components/CardChecklist.vue'
import type { ChecklistItem, Member } from '#shared/types/board'
import type { CardDetailApi } from '~/composables/useCardDetail'

const members: Member[] = [
  { userId: 'u1', name: 'Bea', avatarUrl: null, role: 'editor', boardRole: 'editor', teamRole: null } as Member,
]
const items: ChecklistItem[] = [
  { id: 'a', text: 'Assigned', done: false, position: 1, assigneeId: 'u1', dueDate: '2025-01-05' },
  { id: 'b', text: 'Plain', done: false, position: 2, assigneeId: null, dueDate: null },
]
const cd = { detail: ref(null) } as unknown as CardDetailApi

describe('CardChecklist', () => {
  it('shows assignees and due dates read-only', async () => {
    const w = await mountSuspended(CardChecklist, { props: { items, canEdit: false, cd, members } })
    expect(w.text()).toContain('Jan 5, 2025')
    expect(w.find('button[aria-label="Assign item"]').exists()).toBe(false)
    expect(w.find('button[aria-label="Assigned to Bea"]').exists()).toBe(false)
  })

  it('offers date and assignee buttons to editors, not on templates', async () => {
    const w = await mountSuspended(CardChecklist, { props: { items, canEdit: true, cd, members } })
    expect(w.find('button[aria-label="Assigned to Bea"]').exists()).toBe(true)
    expect(w.find('button[aria-label="Assign item"]').exists()).toBe(true)
    expect(w.find('button[aria-label="Set due date"]').exists()).toBe(true)
    expect(w.find('button[aria-label="Due Jan 5, 2025"]').exists()).toBe(true)

    const tpl = await mountSuspended(CardChecklist, { props: { items, canEdit: true, cd, members, template: true } })
    expect(tpl.find('button[aria-label="Assign item"]').exists()).toBe(false)
    expect(tpl.find('button[aria-label="Set due date"]').exists()).toBe(false)
  })
})
