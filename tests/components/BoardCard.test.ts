import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import BoardCard from '~/components/BoardCard.vue'
import type { BoardField, Card, Member, Tag } from '#shared/types/board'

const tags: Tag[] = [{ id: 't1', name: 'bug', color: '#ef4444' }, { id: 't2', name: 'ui', color: '#3b82f6' }]
const members: Member[] = [
  { userId: 'u1', name: 'Alice', email: 'a@x', avatarUrl: null, role: 'owner', boardRole: 'owner', teamRole: null },
  { userId: 'u2', name: 'Bob', email: 'b@x', avatarUrl: null, role: 'editor', boardRole: 'editor', teamRole: null },
]
const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1', columnId: 'col', title: 'Fix it', description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const mount = (c: Card, canEdit = true, blocked = false) =>
  mountSuspended(BoardCard, { props: { card: c, tags, members, canEdit, today: '2026-10-13', blocked } })

describe('BoardCard', () => {
  it('shows only the title for a bare card', async () => {
    const w = await mount(card())
    expect(w.text()).toContain('Fix it')
    expect(w.find('[aria-label^="Due"]').exists()).toBe(false)
  })

  it('shows tags, priority, overdue date and counts', async () => {
    const w = await mount(card({
      tagIds: ['t2'], priority: 'urgent', dueDate: '2026-10-01',
      checklist: { done: 1, total: 3 }, commentCount: 2, attachmentCount: 4, assigneeIds: ['u1', 'u2'],
    }))
    const text = w.text()
    expect(text).toContain('ui')
    expect(text).not.toContain('bug')
    expect(text).toContain('Urgent')
    expect(text).toContain('1/3')
    expect(text).toContain('2')
    expect(text).toContain('4')
    expect(w.find('[aria-label$="overdue"]').exists()).toBe(true)
  })

  it('shows the date range, estimate, time logged and cover image', async () => {
    const w = await mount(card({ startDate: '2026-10-20', dueDate: '2026-10-25', estimate: 3, timeMinutes: 90, coverAttachmentId: 'a1' }))
    expect(w.find('[aria-label^="Starts"]').exists()).toBe(true)
    expect(w.find('[aria-label="Estimate 3 points"]').exists()).toBe(true)
    expect(w.find('[aria-label="1h 30m logged"]').text()).toContain('1h 30m')
    expect(w.find('img[src="/api/attachments/a1"]').attributes('loading')).toBe('lazy')

    const bare = await mount(card())
    expect(bare.find('img').exists()).toBe(false)
  })

  it('shows the watching eye and the blocked badge', async () => {
    const w = await mount(card({ watching: true }), true, true)
    expect(w.find('[aria-label="You are watching this card"]').exists()).toBe(true)
    expect(w.text()).toContain('Blocked')

    const bare = await mount(card())
    expect(bare.find('[aria-label="You are watching this card"]').exists()).toBe(false)
    expect(bare.text()).not.toContain('Blocked')
  })

  it('emits open on click and delete from the button; viewers get no delete button', async () => {
    const w = await mount(card())
    await w.find('[aria-label="Delete card"]').trigger('click')
    expect(w.emitted('delete')).toHaveLength(1)
    expect(w.emitted('open')).toBeUndefined()
    await w.trigger('click')
    expect(w.emitted('open')).toHaveLength(1)

    const viewer = await mount(card(), false)
    expect(viewer.find('[aria-label="Delete card"]').exists()).toBe(false)
  })

  it('shows values of fields marked show on card', async () => {
    const fields: BoardField[] = [
      { id: 'f1', name: 'Size', kind: 'select', options: [{ id: 'l', label: 'Large', color: '#ef4444' }], position: 1, showOnCard: true },
      { id: 'f2', name: 'Customer', kind: 'text', options: [], position: 2, showOnCard: true },
      { id: 'f3', name: 'Secret', kind: 'text', options: [], position: 3, showOnCard: false },
      { id: 'f4', name: 'Signed', kind: 'checkbox', options: [], position: 4, showOnCard: true },
      { id: 'f5', name: 'Paid', kind: 'checkbox', options: [], position: 5, showOnCard: true },
    ]
    const w = await mountSuspended(BoardCard, {
      props: { card: card({ fields: { f1: 'l', f2: 'Acme', f3: 'hidden', f4: true, f5: false } }), tags, members, canEdit: true, today: '2026-10-13', fields },
    })
    const text = w.text()
    expect(text).toContain('Large')
    expect(text).toContain('Customer: Acme')
    expect(text).toContain('Signed')
    expect(text).not.toContain('hidden')
    expect(text).not.toContain('Paid')
  })

  it('double-clicking the title edits it inline; Enter saves, Escape cancels', async () => {
    vi.useFakeTimers()
    try {
      const w = await mount(card())
      const title = w.find('p.font-medium')
      await title.trigger('click', { detail: 1 })
      await title.trigger('click', { detail: 2 })
      vi.advanceTimersByTime(300)
      expect(w.emitted('open')).toBeUndefined()
      const input = w.find('textarea')
      expect(input.element.value).toBe('Fix it')

      await input.setValue('  Fix  it\nnow ')
      await input.trigger('keydown', { key: 'Enter' })
      expect(w.emitted('rename')).toEqual([['Fix it now']])
      expect(w.find('textarea').exists()).toBe(false)

      await w.trigger('keydown', { key: 'F2' })
      await w.find('textarea').setValue('Other')
      await w.find('textarea').trigger('keydown', { key: 'Escape' })
      expect(w.emitted('rename')).toHaveLength(1)

      // A single click on the title still opens the card, after the double-click window.
      await w.find('p.font-medium').trigger('click', { detail: 1 })
      expect(w.emitted('open')).toBeUndefined()
      vi.advanceTimersByTime(300)
      expect(w.emitted('open')).toHaveLength(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('viewers cannot edit the title; a click opens at once', async () => {
    const w = await mount(card(), false)
    await w.find('p.font-medium').trigger('click', { detail: 2 })
    expect(w.find('textarea').exists()).toBe(false)
    expect(w.emitted('open')).toHaveLength(1)
  })
})
