import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AgentCommandBuilder from '~/components/AgentCommandBuilder.vue'

const columns = [{ id: 'c1', title: 'To do' }, { id: 'c2', title: 'Review' }]
const bots = [{ id: 'bot1', name: 'Claude (TR)' }]
const value = (w: Awaited<ReturnType<typeof mountSuspended>>, id: string) =>
  (w.find(`textarea[data-testid="${id}"], [data-testid="${id}"] textarea`).element as HTMLTextAreaElement).value

describe('AgentCommandBuilder', () => {
  it('builds the login and install commands for the board\'s agent rules', async () => {
    const w = await mountSuspended(AgentCommandBuilder, { props: { bots, boardId: 'b1', columns } })
    expect(value(w, 'agent-login')).toMatch(/^kanso login --profile claude-tr --url http\S+$/)
    expect(value(w, 'agent-install')).toBe('kanso agent install --profile claude-tr --name claude-tr --board b1 --claude')
    // The CLI install block comes first.
    expect(w.find('[data-testid="cli-install"]').exists()).toBe(true)
    // Rules bring their own instructions and comment mode.
    expect(w.text()).not.toContain('Instructions')
    expect(w.text()).not.toContain('Comment the result')
  })

  it('fills in a token created just now', async () => {
    const w = await mountSuspended(AgentCommandBuilder, { props: { bots, boardId: 'b1', columns, tokens: { bot1: 'kb_new' } } })
    expect(value(w, 'agent-login')).toMatch(/ --token kb_new$/)
    expect(w.text()).toContain('This holds the new token')
  })

  it('asks for columns or activity for the activity trigger', async () => {
    const w = await mountSuspended(AgentCommandBuilder, { props: { bots, boardId: 'b1', columns } })
    await w.find('[role="radio"][value="activity"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="agent-problems"]').text()).toContain('Pick columns or activity.')
    expect(w.find('[data-testid="agent-install"]').exists()).toBe(false)
    expect(w.text()).toContain('Instructions')
  })

  it('offers only notifications without a board', async () => {
    const w = await mountSuspended(AgentCommandBuilder, { props: { bots, boardId: null, columns: [] } })
    expect(w.find('[role="radio"][value="rules"]').exists()).toBe(false)
    expect(value(w, 'agent-install')).toBe('kanso agent install --profile claude-tr --name claude-tr --notifications --claude --comment failure')
  })
})
