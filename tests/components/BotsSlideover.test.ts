import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import BotsSlideover from '~/components/BotsSlideover.vue'
import type { BoardBot, BotToken } from '#shared/types/bots'

// Slideover and modal teleport to the body; render their slots in place while open.
const Overlay = defineComponent({
  props: { open: Boolean, title: String },
  setup: (props, { slots }) => () => props.open ? h('div', [h('h2', props.title), slots.body?.(), slots.footer?.()]) : null,
})
const stubs = { USlideover: Overlay, UModal: Overlay }

const claude: BoardBot = { id: 'bot1', name: 'Claude', role: 'editor', avatarUrl: null, createdAt: '2026-11-20T10:00:00Z', tokens: [] }
const posted: unknown[] = []
registerEndpoint('/api/boards/b1/bots', {
  method: 'POST',
  handler: async (event) => {
    const body = await readBody(event)
    posted.push(body)
    return { ...claude, name: body.name, role: body.role }
  },
})
registerEndpoint('/api/teams/t1/bots', {
  method: 'POST',
  handler: async (event) => {
    const body = await readBody(event)
    posted.push({ team: body })
    return { ...claude, id: 'bot2', name: body.name, role: body.role }
  },
})
const token: BotToken = { id: 't1', name: 'ci', prefix: 'kb_Ab12Cd', scopes: ['read', 'write'], createdAt: '2026-11-20T10:00:00Z', lastUsedAt: null, expiresAt: null, revokedAt: null, viewable: true, lastViewedAt: null }
registerEndpoint('/api/bots/bot1/tokens', {
  method: 'POST',
  handler: async (event) => {
    posted.push(await readBody(event))
    return { ...token, token: 'kb_secretsecretsecret' }
  },
})

describe('BotsSlideover', () => {
  it('adds a bot, then shows a new token once with the MCP command', async () => {
    posted.length = 0
    const w = await mountSuspended(BotsSlideover, { props: { open: true, boardId: 'b1', bots: [] }, global: { stubs } })
    expect(w.text()).toContain('No bots yet.')

    await w.find('[data-testid="add-bot"] input').setValue('Claude')
    await w.find('[data-testid="add-bot"]').trigger('submit')
    await flushPromises()
    expect(posted[0]).toEqual({ name: 'Claude', role: 'editor' })
    await vi.waitFor(() => expect(w.findAll('[data-testid="bot"]')).toHaveLength(1))
    expect(w.emitted('changed')).toHaveLength(1)

    const newToken = w.findAll('button').find(b => b.text() === 'New token')!
    await newToken.trigger('click')
    await w.find('#new-bot-token input').setValue('ci')
    await w.find('#new-bot-token').trigger('submit')
    await flushPromises()
    expect(posted[1]).toEqual({ name: 'ci', scopes: ['read', 'write'], expiresInDays: null })

    await vi.waitFor(() => expect(w.find('[data-testid="new-token"]').exists()).toBe(true))
    expect((w.find('input[data-testid="new-token"], [data-testid="new-token"] input').element as HTMLInputElement).value).toBe('kb_secretsecretsecret')
    expect(w.text()).toContain('Copy the token now')
    const command = (w.find('textarea[data-testid="mcp-command"], [data-testid="mcp-command"] textarea').element as HTMLTextAreaElement).value
    expect(command).toContain('claude mcp add --transport http kanso')
    expect(command).toContain('Bearer kb_secretsecretsecret')
    // How to install the CLI and log in with the new token.
    const panel = w.findAll('[data-testid="cli-install"]').at(-1)!
    expect((panel.find('textarea').element as HTMLTextAreaElement).value).toMatch(/\/cli\/install\.sh \| sh\nkanso login --url http/)
    // The list keeps only the token's metadata.
    const row = w.find('[data-testid="bot-token"]')
    expect(row.text()).toContain('kb_Ab12Cd')
    expect(row.text()).not.toContain('kb_secret')

    // Done closes the dialog; the token is not shown again.
    await w.findAll('button').find(b => b.text() === 'Done')!.trigger('click')
    expect(w.text()).not.toContain('kb_secretsecretsecret')
    expect(w.find('[data-testid="new-token"]').exists()).toBe(false)
  })

  it('owners open the access limits of a bot from its row', async () => {
    const w = await mountSuspended(BotsSlideover, { props: { open: true, boardId: 'b1', bots: [claude], limitedIds: ['bot1'], canLimit: true }, global: { stubs } })
    const shield = w.find('button[aria-label="Limit access"]')
    expect(shield.text()).toContain('Limited')
    await shield.trigger('click')
    expect(w.emitted('limit')).toEqual([['bot1']])
  })

  it('shows no shield on an archived board unless the bot is limited', async () => {
    const w = await mountSuspended(BotsSlideover, { props: { open: true, boardId: 'b1', bots: [claude], canLimit: false }, global: { stubs } })
    expect(w.find('button[aria-label="Limit access"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Limited')
  })

  it('in team mode adds bots to the team and explains the team scope', async () => {
    posted.length = 0
    const w = await mountSuspended(BotsSlideover, { props: { open: true, teamId: 't1', bots: [] }, global: { stubs } })
    await w.find('[data-testid="add-bot"] input').setValue('Team agent')
    await w.find('[data-testid="add-bot"]').trigger('submit')
    await flushPromises()
    expect(posted[0]).toEqual({ team: { name: 'Team agent', role: 'editor' } })
    await vi.waitFor(() => expect(w.findAll('[data-testid="bot"]')).toHaveLength(1))

    await w.findAll('button').find(b => b.text() === 'New token')!.trigger('click')
    expect(w.text()).toContain("Changes this team's boards as the bot")
  })

  it('builds the agent install command for a bot, with a token created just now', async () => {
    const w = await mountSuspended(BotsSlideover, { props: { open: true, boardId: 'b1', bots: [claude], columns: [{ id: 'c1', title: 'To do' }] }, global: { stubs } })
    await w.find('[data-testid="run-as-agent"]').trigger('click')
    const install = () => (w.find('textarea[data-testid="agent-install"], [data-testid="agent-install"] textarea').element as HTMLTextAreaElement).value
    const login = () => (w.find('textarea[data-testid="agent-login"], [data-testid="agent-login"] textarea').element as HTMLTextAreaElement).value
    expect(install()).toBe('kanso agent install --profile claude --name claude --board b1 --claude')
    expect(login()).not.toContain('--token')

    await w.findAll('button').find(b => b.text() === 'New token')!.trigger('click')
    await w.find('#new-bot-token input').setValue('agent')
    await w.find('#new-bot-token').trigger('submit')
    await flushPromises()
    const runFromToken = () => w.findAll('button').find(b => b.text() === 'Run as agent' && !b.attributes('data-testid'))
    await vi.waitFor(() => expect(runFromToken()).toBeDefined())
    await runFromToken()!.trigger('click')
    await flushPromises()
    expect(login()).toMatch(/ --token kb_secretsecretsecret$/)
  })

  it('offers no agent command for team bots', async () => {
    const w = await mountSuspended(BotsSlideover, { props: { open: true, teamId: 't1', bots: [claude] }, global: { stubs } })
    expect(w.find('[data-testid="run-as-agent"]').exists()).toBe(false)
  })
})
