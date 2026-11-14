import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CardMatrix from '~/components/CardMatrix.vue'
import type { BoardMatrixRoom, MatrixThreadView } from '#shared/types/matrix'
import type { CardDetailApi } from '~/composables/useCardDetail'

const room: BoardMatrixRoom = { homeserverUrl: 'https://matrix.example', roomId: '!team:example', roomName: 'Team room', botUserId: '@bot:example' }
const view: MatrixThreadView = {
  roomId: '!team:example',
  eventId: '$root',
  more: false,
  messages: [
    { id: '$root', sender: '@bot:example', senderName: 'Kanso', fromBot: true, createdAt: '2026-11-14T12:00:00Z', body: 'Fix login · Board', html: null, edited: false },
    { id: '$r1', sender: '@dana:example', senderName: 'Dana', fromBot: false, createdAt: '2026-11-14T12:05:00Z', body: 'On it', html: null, edited: true },
  ],
}
registerEndpoint('/api/cards/c1/matrix-thread', () => view)

const cd = (linkMatrixThread = vi.fn()) => ({ cardId: ref('c1'), linkMatrixThread, unlinkMatrixThread: vi.fn() }) as unknown as CardDetailApi

describe('CardMatrix', () => {
  it('offers editors to start or link a thread', async () => {
    const link = vi.fn()
    const w = await mountSuspended(CardMatrix, { props: { room, thread: null, canEdit: true, cd: cd(link) } })
    expect(w.text()).toContain('Team room')
    const start = w.findAll('button').find(b => b.text() === 'Start a thread')!
    await start.trigger('click')
    expect(link).toHaveBeenCalledWith()
    expect(w.text()).toContain('Link a message')
  })

  it('shows the thread to viewers without edit buttons', async () => {
    const w = await mountSuspended(CardMatrix, { props: { room, thread: { roomId: '!team:example', eventId: '$root' }, canEdit: false, cd: cd() } })
    await flushPromises()
    const items = w.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('Kanso')
    expect(items[0]!.text()).toContain('Bot')
    expect(items[1]!.text()).toContain('Dana')
    expect(items[1]!.text()).toContain('On it')
    expect(items[1]!.text()).toContain('edited')
    expect(w.text()).not.toContain('Unlink')
    expect(w.find('a[href="https://matrix.to/#/!team%3Aexample/%24root"]').exists()).toBe(true)
  })
})
