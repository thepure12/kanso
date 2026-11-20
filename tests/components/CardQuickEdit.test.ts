import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import CardQuickEdit from '~/components/CardQuickEdit.vue'
import type { Card, Member, Tag } from '#shared/types/board'

// The modal teleports to the body; render its slots in place while open.
const Overlay = defineComponent({
  props: { open: Boolean, title: String },
  setup: (props, { slots }) => () => props.open ? h('div', [h('h2', props.title), slots.body?.()]) : null,
})
const stubs = { UModal: Overlay }

const card = { id: 'c1', title: 'Write docs', tagIds: ['t1'], assigneeIds: [], dueDate: '2026-12-01' } as unknown as Card
const tags: Tag[] = [{ id: 't1', name: 'Bug', color: '#ff0000' }, { id: 't2', name: 'UI', color: '#00ff00' }] as Tag[]
const members: Member[] = [{ userId: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null, role: 'editor' }] as Member[]

function item(w: Awaited<ReturnType<typeof mountSuspended>>, label: string) {
  return w.findAll('[role="option"]').find(o => o.text().includes(label))!
}

describe('CardQuickEdit', () => {
  it('toggles card tags and keeps the dialog open', async () => {
    const w = await mountSuspended(CardQuickEdit, { props: { open: true, card, mode: 'tags', tags, members }, global: { stubs } })
    expect(w.text()).toContain('Card tags')
    await item(w, 'UI').trigger('click')
    await item(w, 'Bug').trigger('click')
    expect(w.emitted('update')).toEqual([[{ tagIds: ['t1', 't2'] }], [{ tagIds: [] }]])
    expect(w.emitted('update:open')).toBeUndefined()
  })

  it('toggles assignees', async () => {
    const w = await mountSuspended(CardQuickEdit, { props: { open: true, card, mode: 'assignees', tags, members }, global: { stubs } })
    await item(w, 'Ada').trigger('click')
    expect(w.emitted('update')).toEqual([[{ assigneeIds: ['u1'] }]])
  })

  it('sets or clears the due date and closes', async () => {
    const w = await mountSuspended(CardQuickEdit, { props: { open: true, card, mode: 'due', tags, members }, global: { stubs } })
    await w.find('input[type="date"]').setValue('2026-12-24')
    await w.find('form').trigger('submit')
    expect(w.emitted('update')![0]).toEqual([{ dueDate: '2026-12-24' }])
    expect(w.emitted('update:open')![0]).toEqual([false])

    const again = await mountSuspended(CardQuickEdit, { props: { open: true, card, mode: 'due', tags, members }, global: { stubs } })
    await again.findAll('button').find(b => b.text() === 'Clear')!.trigger('click')
    expect(again.emitted('update')).toEqual([[{ dueDate: null }]])
  })
})
