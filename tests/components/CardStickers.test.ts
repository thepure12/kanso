import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import CardStickers from '~/components/CardStickers.vue'
import BoardCard from '~/components/BoardCard.vue'
import type { Card } from '#shared/types/board'

describe('CardStickers', () => {
  it('removes a sticker on click for editors', async () => {
    const w = await mountSuspended(CardStickers, { props: { stickers: ['🔥', '⭐'], canEdit: true } })
    await w.find('button[aria-label*="🔥"]').trigger('click')
    expect(w.emitted('update')).toEqual([[['⭐']]])
  })

  it('only shows the stickers to readers', async () => {
    const w = await mountSuspended(CardStickers, { props: { stickers: ['🔥'], canEdit: false } })
    expect(w.text()).toContain('🔥')
    expect(w.find('button').exists()).toBe(false)
  })

  it('shows nothing to readers without stickers', async () => {
    const w = await mountSuspended(CardStickers, { props: { stickers: [], canEdit: false } })
    expect(w.text()).toBe('')
  })
})

describe('BoardCard stickers', () => {
  const card = (stickers?: string[]): Card => ({
    id: 'c1', columnId: 'col', title: 'Fix it', description: '', position: 1,
    assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
    checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {},
    createdBy: null, createdByName: null, createdAt: '2026-10-13T00:00:00.000Z', ...(stickers && { stickers }),
  } as Card)
  const mount = (c: Card) => mountSuspended(BoardCard, { props: { card: c, tags: [], members: [], canEdit: false, today: '2026-10-13', blocked: false, blocking: false } })

  it('shows the stickers on the front', async () => {
    const w = await mount(card(['🦄', '🚀']))
    expect(w.find('[aria-label="Stickers: 🦄 🚀"]').text()).toBe('🦄🚀')
  })

  it('copes with cards without the field (old cached data)', async () => {
    const w = await mount(card())
    expect(w.text()).not.toContain('Stickers')
  })
})
