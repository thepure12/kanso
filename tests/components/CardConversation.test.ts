import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CardComments from '~/components/CardComments.vue'
import CardConversation from '~/components/CardConversation.vue'
import type { Comment } from '#shared/types/board'
import type { BoardMatrixRoom, MatrixThreadView } from '#shared/types/matrix'
import type { CardDetailApi } from '~/composables/useCardDetail'

const room: BoardMatrixRoom = { homeserverUrl: 'https://matrix.example', roomId: '!team:example', roomName: 'Team room', botUserId: '@bot:example', postActivity: false, activityEvents: [] }
const view: MatrixThreadView = {
  roomId: '!team:example',
  eventId: '$root',
  boardId: 'b1',
  more: false,
  myLink: null,
  messages: [
    { id: '$root', sender: '@bot:example', senderName: 'Kanso', fromBot: true, kansoAuthorId: null, kansoUserId: null, createdAt: '2026-11-14T12:00:00Z', body: 'Fix login · Board', html: null, edited: false },
    { id: '$r1', sender: '@dana:example', senderName: 'Dana', fromBot: false, kansoAuthorId: null, kansoUserId: null, createdAt: '2026-11-14T12:10:00Z', body: 'On it', html: null, edited: false },
  ],
}
registerEndpoint('/api/cards/c2/matrix-thread', () => view)

const comment = (id: string, body: string, createdAt: string): Comment =>
  ({ id, authorId: 'u2', authorName: 'Sam', authorAvatarUrl: null, importedAuthor: null, body, createdAt, updatedAt: createdAt, reactions: [] })

const cd = () => ({ cardId: ref('c2'), linkMatrixThread: vi.fn(), unlinkMatrixThread: vi.fn(), addComment: vi.fn(), upload: vi.fn() }) as unknown as CardDetailApi

describe('CardConversation', () => {
  it('lists comments and Matrix messages together, newest first', async () => {
    const items = [comment('k1', 'First comment', '2026-11-14T12:05:00Z'), comment('k2', 'Second comment', '2026-11-14T12:20:00Z')]
    const w = await mountSuspended(CardConversation, {
      props: { items, canEdit: false, isOwner: false, canReact: false, cd: cd(), members: [], room, thread: { roomId: '!team:example', eventId: '$root' } },
    })
    await flushPromises()
    const texts = w.findAll('li').map(li => li.text())
    expect(texts).toHaveLength(4)
    expect(texts[0]).toContain('Second comment')
    expect(texts[1]).toContain('On it')
    expect(texts[1]).toContain('Matrix')
    expect(texts[2]).toContain('First comment')
    expect(texts[3]).toContain('Kanso')
  })

  it('writes to the Matrix thread by default when a reply is possible', async () => {
    const w = await mountSuspended(CardConversation, {
      props: { items: [], canEdit: true, isOwner: false, canReact: true, cd: cd(), members: [], room, thread: { roomId: '!team:example', eventId: '$root' } },
    })
    await flushPromises()
    expect(w.findAll('[role="tab"]')).toHaveLength(2)
    expect(w.find('textarea').attributes('placeholder')).toContain('Reply in the thread')
  })

  it('offers only comments as a target without a thread', async () => {
    const w = await mountSuspended(CardConversation, {
      props: { items: [], canEdit: true, isOwner: false, canReact: true, cd: cd(), members: [], room, thread: null },
    })
    expect(w.text()).toContain('Start a thread')
    expect(w.findAll('[role="tab"]')).toHaveLength(0)
    expect(w.findAll('button').some(b => b.text() === 'Comment')).toBe(true)
  })

  it('lets commenters comment but not reply in the thread', async () => {
    const w = await mountSuspended(CardConversation, {
      props: { items: [], canEdit: false, canComment: true, isOwner: false, canReact: true, cd: cd(), members: [], room, thread: { roomId: '!team:example', eventId: '$root' } },
    })
    await flushPromises()
    expect(w.findAll('[role="tab"]')).toHaveLength(0)
    expect(w.find('textarea').attributes('placeholder')).not.toContain('Reply in the thread')
    expect(w.findAll('button').some(b => b.text() === 'Comment')).toBe(true)
  })
})

describe('comment order', () => {
  afterEach(() => setCommentOrder('newest'))

  it('lists the merged conversation oldest first with the composer below when newest last', async () => {
    setCommentOrder('oldest')
    const items = [comment('k1', 'First comment', '2026-11-14T12:05:00Z'), comment('k2', 'Second comment', '2026-11-14T12:20:00Z')]
    const w = await mountSuspended(CardConversation, {
      props: { items, canEdit: false, canComment: true, isOwner: false, canReact: false, cd: cd(), members: [], room, thread: { roomId: '!team:example', eventId: '$root' } },
    })
    await flushPromises()
    const texts = w.findAll('li').map(li => li.text())
    expect(texts[0]).toContain('Kanso')
    expect(texts[3]).toContain('Second comment')
    expect(w.find('form').classes()).not.toContain('order-1')
    expect(w.find('form').element.parentElement!.classList).toContain('order-1')
  })

  it('reverses CardComments and stores the choice', async () => {
    const items = [comment('k1', 'First comment', '2026-11-14T12:05:00Z'), comment('k2', 'Second comment', '2026-11-14T12:20:00Z')]
    const w = await mountSuspended(CardComments, {
      props: { items, canEdit: true, isOwner: false, canReact: false, cd: cd(), members: [] },
    })
    expect(w.findAll('li')[0]!.text()).toContain('Second comment')
    expect(w.find('form').classes()).not.toContain('order-last')
    await w.find('button[aria-label="Show newest comments last"]').trigger('click')
    expect(localStorage.getItem('kanban:comment-order')).toBe('oldest')
    expect(w.findAll('li')[0]!.text()).toContain('First comment')
    expect(w.find('form').classes()).toContain('order-last')
    await w.find('button[aria-label="Show newest comments first"]').trigger('click')
    expect(localStorage.getItem('kanban:comment-order')).toBeNull()
  })
})
