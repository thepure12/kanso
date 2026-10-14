import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import CardRecurrenceForm from '~/components/CardRecurrenceForm.vue'
import type { CardRecurrence, Column, RecurrenceInput } from '#shared/types/board'

const columns: Column[] = [
  { id: 'todo', title: 'Todo', position: 1, color: null, wipLimit: null, rules: [] },
  { id: 'done', title: 'Done', position: 2, color: null, wipLimit: null, rules: [] },
]
const recurrence: CardRecurrence = {
  id: 'r', templateId: 't', columnId: 'done', rule: 'weekly', interval: 2, weekdays: [1, 5], dayOfMonth: null,
  dueInDays: 3, active: true, nextRunAt: '2026-10-16T00:00:00.000Z', lastRunAt: null,
}

describe('CardRecurrenceForm', () => {
  it('saves the schedule with the chosen weekdays', async () => {
    const w = await mountSuspended(CardRecurrenceForm, { props: { recurrence, columns, defaultColumnId: 'todo', canEdit: true } })
    expect(w.text()).toContain('Every 2 weeks on Mon, Fri')
    // Toggle Wednesday on, then save.
    await w.findAll('button').find(b => b.text() === 'Wed')!.trigger('click')
    await w.find('form').trigger('submit')
    const [[input]] = w.emitted('save') as [[RecurrenceInput]]
    expect(input).toEqual({ columnId: 'done', rule: 'weekly', interval: 2, weekdays: [1, 3, 5], dayOfMonth: null, dueInDays: 3, active: true })
  })

  it('is read-only for viewers', async () => {
    const w = await mountSuspended(CardRecurrenceForm, { props: { recurrence: null, columns, defaultColumnId: 'todo', canEdit: false } })
    expect(w.find('form').exists()).toBe(false)
    expect(w.text()).toContain('Does not repeat.')
  })
})
