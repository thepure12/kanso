import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import AccountBots from '~/components/AccountBots.vue'
import type { AccountBot } from '#shared/types/bots'

const helper: AccountBot = {
  id: 'ab1', name: 'Helper', avatarUrl: null, createdAt: '2026-11-20T10:00:00Z', tokens: [],
  boards: [{ id: 'b1', name: 'Roadmap', role: 'editor', owner: true }],
}
const posted: unknown[] = []
let list: AccountBot[] = [helper]
registerEndpoint('/api/account/bots', {
  method: 'GET',
  handler: () => list,
})
registerEndpoint('/api/account/bots', {
  method: 'POST',
  handler: async (event) => {
    const body = await readBody(event)
    posted.push(body)
    return { ...helper, id: 'ab2', name: body.name, boards: [] }
  },
})
registerEndpoint('/api/boards', {
  method: 'GET',
  handler: () => [
    { id: 'b1', name: 'Roadmap', role: 'owner', archivedAt: null },
    { id: 'b2', name: 'Ops', role: 'owner', archivedAt: null },
    { id: 'b3', name: 'Shared', role: 'editor', archivedAt: null },
  ],
})

describe('AccountBots', () => {
  it('lists the bots with their boards and adds a new one', async () => {
    posted.length = 0
    list = [helper]
    const w = await mountSuspended(AccountBots)
    await flushPromises()
    expect(w.findAll('[data-testid="account-bot"]')).toHaveLength(1)
    expect(w.find('[data-testid="account-bot-board"]').text()).toContain('Roadmap')

    await w.find('[data-testid="add-account-bot"] input').setValue('Agent')
    await w.find('[data-testid="add-account-bot"]').trigger('submit')
    await flushPromises()
    expect(posted[0]).toEqual({ name: 'Agent' })
    await vi.waitFor(() => expect(w.findAll('[data-testid="account-bot"]')).toHaveLength(2))
    expect(w.text()).toContain('Not on any board yet.')
  })
})
