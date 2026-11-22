import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ColumnRulesModal from '~/components/ColumnRulesModal.vue'
import type { BoardButton } from '#shared/buttons'

const column = { id: 'c1', title: 'Testing', position: 1, color: null, wipLimit: null, outline: null, rules: [] }
const button = (id: string, name: string, columnIds: string[] | null): BoardButton =>
  ({ id, scope: 'card', name, icon: null, color: 'accent', shared: true, columnIds, cardIds: [], steps: [{ kind: 'archive' }] })
const buttons = [button('b1', 'Everywhere', null), button('b2', 'Elsewhere', ['c2']), button('b3', 'Only here', ['c1'])]

async function mount() {
  const w = await mountSuspended(ColumnRulesModal, {
    attachTo: document.body,
    props: { open: true, column, tags: [], members: [], cards: [], buttons, columnIds: ['c1', 'c2', 'c3'] },
  })
  await flushPromises()
  return w
}

const checkbox = (name: string) => document.body.querySelector(`[aria-label="Show ${name} on cards in this column"]`) as HTMLButtonElement

describe('ColumnRulesModal card buttons', () => {
  it('ticks the buttons shown in the column and changes their columns', async () => {
    const w = await mount()
    expect(checkbox('Everywhere').getAttribute('aria-checked')).toBe('true')
    expect(checkbox('Elsewhere').getAttribute('aria-checked')).toBe('false')
    checkbox('Everywhere').click()
    checkbox('Elsewhere').click()
    // Its only column can go too: the button is then left on the cards it was added to.
    checkbox('Only here').click()
    await flushPromises()
    expect(w.emitted('buttonColumns')).toEqual([
      [buttons[0], ['c2', 'c3']],
      [buttons[1], ['c2', 'c1']],
      [buttons[2], []],
    ])
    w.unmount()
  })
})

describe('ColumnRulesModal button rules', () => {
  it('lists add_button / remove_button rules with the button name', async () => {
    const withRules = { ...column, rules: [
      { id: 'r1', kind: 'add_button' as const, buttonId: 'b1' },
      { id: 'r2', kind: 'remove_button' as const, buttonId: 'b3' },
    ] }
    const w = await mountSuspended(ColumnRulesModal, {
      attachTo: document.body,
      props: { open: true, column: withRules, tags: [], members: [], cards: [], ruleButtons: buttons },
    })
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Add button')
    expect(text).toContain('Everywhere')
    expect(text).toContain('Remove button')
    expect(text).toContain('Only here')
    w.unmount()
  })
})
