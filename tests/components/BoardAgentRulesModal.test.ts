import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import BoardAgentRulesModal from '~/components/BoardAgentRulesModal.vue'
import type { AgentRule, Member } from '#shared/types/board'

const columns = [
  { id: 'c1', title: 'To do', position: 1, color: null, wipLimit: null, outline: null, rules: [] },
  { id: 'c2', title: 'Review', position: 2, color: null, wipLimit: null, outline: null, rules: [] },
]
const member = (userId: string, name: string, isBot: boolean) =>
  ({ userId, name, email: `${name}@x`, avatarUrl: null, role: 'editor', boardRole: 'editor', teamRole: null, isBot, accountBot: false }) as Member
const rule: AgentRule = {
  id: 'r1', name: 'Pick up', botId: 'bot1', event: 'card_moved', columnId: 'c1', tagId: null,
  instructions: 'Work on it.', moveColumnId: 'c2', comment: 'failure', active: true,
}

async function mount(members: Member[], rules: AgentRule[] = []) {
  const w = await mountSuspended(BoardAgentRulesModal, {
    attachTo: document.body,
    props: { open: true, rules, tags: [], columns, members, canEdit: true },
  })
  await flushPromises()
  return w
}

describe('BoardAgentRulesModal', () => {
  it('lists rules in words and asks for a bot first', async () => {
    const w = await mount([member('u1', 'Ann', false)], [rule])
    const text = document.body.textContent ?? ''
    expect(text).toContain('Pick up')
    expect(text).toContain('When a card is moved into To do')
    expect(text).toContain('? works on the card with the instructions, then moves it to Review')
    expect(document.body.querySelector('[data-testid="no-bots"]')).not.toBeNull()
    w.unmount()
  })

  it('adds a rule for the board\'s bot', async () => {
    const w = await mount([member('u1', 'Ann', false), member('bot1', 'Claude', true)])
    const form = document.body.querySelector('form')!
    const name = form.querySelector('input') as HTMLInputElement
    name.value = ' Triage '
    name.dispatchEvent(new Event('input'))
    const instructions = form.querySelector('textarea') as HTMLTextAreaElement
    instructions.value = 'Sort it out.'
    instructions.dispatchEvent(new Event('input'))
    await flushPromises()
    form.dispatchEvent(new Event('submit'))
    await flushPromises()
    expect(w.emitted('add')).toEqual([[{
      name: 'Triage', botId: 'bot1', event: 'card_moved', columnId: null, tagId: null,
      instructions: 'Sort it out.', moveColumnId: null, comment: 'failure',
    }]])
    w.unmount()
  })
})
