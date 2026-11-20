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
const token: BotToken = { id: 't1', name: 'ci', prefix: 'kb_Ab12Cd', scopes: ['read', 'write'], createdAt: '2026-11-20T10:00:00Z', lastUsedAt: null, expiresAt: null, revokedAt: null }
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
    expect(w.text()).toContain('This is the only time the token is shown')
    const command = (w.find('textarea').element as HTMLTextAreaElement).value
    expect(command).toContain('claude mcp add --transport http kanso')
    expect(command).toContain('Bearer kb_secretsecretsecret')
    // The list keeps only the token's metadata.
    const row = w.find('[data-testid="bot-token"]')
    expect(row.text()).toContain('kb_Ab12Cd')
    expect(row.text()).not.toContain('kb_secret')

    // Done closes the dialog; the token is not shown again.
    await w.findAll('button').find(b => b.text() === 'Done')!.trigger('click')
    expect(w.text()).not.toContain('kb_secretsecretsecret')
    expect(w.find('[data-testid="new-token"]').exists()).toBe(false)
  })
})
