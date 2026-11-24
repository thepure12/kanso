import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import CardModal from '~/components/CardModal.vue'
import type { Card, CardDetail, Column } from '#shared/types/board'

const detail: CardDetail = {
  checklists: [], matrixThread: null, comments: [], attachments: [], activity: [], timeEntries: [], timeTotal: 0,
  watchers: [], watching: false, links: [], fields: {}, reminders: [],
}
registerEndpoint('/api/cards/c1', () => detail)

const columns: Column[] = [
  { id: 'col1', title: 'To do' } as Column,
  { id: 'col2', title: 'Doing' } as Column,
]
const card = (patch: Partial<Card> = {}): Card => ({
  id: 'c1', columnId: 'col1', title: 'Fix login', description: '', position: 1024, assigneeIds: [], tagIds: [],
  startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false,
  blockerIds: [], fields: {}, stickers: [], createdBy: null, createdByName: null,
  createdAt: '2026-11-24T12:00:00Z', completedAt: null, ...patch,
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CardModal', () => {
  it('keeps a description draft when someone else moves the card', async () => {
    const w = await mountSuspended(CardModal, {
      props: {
        open: true, card: card(), members: [], tags: [], fields: [], cards: [card()], columns,
        canEdit: true, isOwner: false, createTag: async () => undefined, remoteVersion: 0,
      },
    })
    await flushPromises()
    const textarea = () => document.body.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add more detail (Markdown)"]')!
    const input = textarea()
    input.value = 'Half-written description'
    input.dispatchEvent(new Event('input'))
    await flushPromises()

    // A board reload after a remote move hands the dialog a new object for the same card.
    const moved = card({ columnId: 'col2', position: 2048 })
    await w.setProps({ card: moved, cards: [moved], remoteVersion: 1 })
    await flushPromises()

    expect(textarea().value).toBe('Half-written description')
  })

  it('shows the other card\'s description when it switches cards', async () => {
    const other = card({ id: 'c2', description: 'Other text' })
    registerEndpoint('/api/cards/c2', () => detail)
    const w = await mountSuspended(CardModal, {
      props: {
        open: true, card: card(), members: [], tags: [], fields: [], cards: [card(), other], columns,
        canEdit: true, isOwner: false, createTag: async () => undefined, remoteVersion: 0,
      },
    })
    await flushPromises()
    await w.setProps({ card: other })
    await flushPromises()
    expect(document.body.textContent).toContain('Other text')
  })
})
