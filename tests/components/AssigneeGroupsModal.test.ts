import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import AssigneeGroupsModal from '~/components/AssigneeGroupsModal.vue'
import type { AssigneeGroup, Member } from '#shared/types/board'

// The modal teleports to the body; render its body slot in place while open.
const Overlay = defineComponent({
  props: { open: Boolean, title: String },
  setup: (props, { slots }) => () => props.open ? h('div', [h('h2', props.title), slots.body?.()]) : null,
})

const members = [
  { userId: 'u1', name: 'Ann', email: 'ann@x.test', role: 'owner', avatarUrl: null, isBot: false },
  { userId: 'u2', name: 'Bob', email: 'bob@x.test', role: 'editor', avatarUrl: null, isBot: false },
] as unknown as Member[]
const groups: AssigneeGroup[] = [{ id: 'g1', name: 'Crew', userIds: ['u1', 'u2'] }]

describe('AssigneeGroupsModal', () => {
  it('lists groups with their size, renames and adds groups', async () => {
    const wrapper = await mountSuspended(AssigneeGroupsModal, {
      props: { open: true, groups, members },
      global: { stubs: { UModal: Overlay } },
    })
    expect(wrapper.text()).toContain('2 people')

    const [name, draft] = wrapper.findAll('input[type="text"], input:not([type])')
    await name!.setValue('Core')
    await name!.trigger('change')
    expect(wrapper.emitted('update')?.[0]).toEqual([groups[0], { name: 'Core' }])

    await draft!.setValue('  Night shift ')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create')?.[0]).toEqual([{ name: 'Night shift', userIds: [] }])
  })

  it('shows a hint without groups', async () => {
    const wrapper = await mountSuspended(AssigneeGroupsModal, {
      props: { open: true, groups: [], members },
      global: { stubs: { UModal: Overlay } },
    })
    expect(wrapper.text()).toContain('No assignee groups yet.')
  })
})
