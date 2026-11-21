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
const mount = (c: Card, canEdit = true, blocked = false, blocking = false) =>
  mountSuspended(BoardCard, { props: { card: c, tags, members, canEdit, today: '2026-10-13', blocked, blocking } })

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
    expect(bare.text()).not.toContain('Blocks')
  })

  it('shows the blocks badge on cards that block another card', async () => {
    const w = await mount(card(), true, false, true)
    expect(w.text()).toContain('Blocks')
    expect(w.text()).not.toContain('Blocked')
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

  it('e edits the title and x toggles selection on the focused card; editors only', async () => {
    const w = await mount(card())
    await w.trigger('keydown', { key: 'x' })
    expect(w.emitted('select')).toHaveLength(1)
    await w.trigger('keydown', { key: 'x', ctrlKey: true })
    expect(w.emitted('select')).toHaveLength(1)
    await w.trigger('keydown', { key: 'e' })
    const input = w.find('textarea')
    expect(input.exists()).toBe(true)
    // Keys typed in the title box stay there.
    await input.trigger('keydown', { key: 'x' })
    expect(w.emitted('select')).toHaveLength(1)
    await input.trigger('keydown', { key: 'Escape' })
    expect(w.find('textarea').exists()).toBe(false)

    const viewer = await mount(card(), false)
    await viewer.trigger('keydown', { key: 'x' })
    await viewer.trigger('keydown', { key: 'e' })
    expect(viewer.emitted('select')).toBeUndefined()
    expect(viewer.find('textarea').exists()).toBe(false)
  })
  it('shows card buttons at the bottom while the card is editable and runs them on click', async () => {
    const buttons = [{ id: 'b1', scope: 'card' as const, name: 'Ship', icon: null, color: 'success' as const, shared: true, columnIds: null, cardIds: [], steps: [{ kind: 'archive' as const }] }]
    const editable = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13', buttons } })
    const group = editable.find('[role="group"][aria-label="Card buttons"]')
    expect(group.exists()).toBe(true)
    const ship = group.findAll('button').find(b => b.text() === 'Ship')!
    expect(ship).toBeTruthy()
    await ship.trigger('click')
    expect(editable.emitted('runButton')).toEqual([[buttons[0]]])
    expect(editable.emitted('open')).toBeUndefined()
    expect(editable.find('[aria-label="Run a button on this card"]').exists()).toBe(false)
    const readOnly = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: false, today: '2026-10-13', buttons } })
    expect(readOnly.find('[aria-label="Card buttons"]').exists()).toBe(false)
    const none = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13' } })
    expect(none.find('[aria-label="Card buttons"]').exists()).toBe(false)
  })
  it('offers only the card buttons shown in the card\'s column', async () => {
    const button = { id: 'b1', scope: 'card' as const, name: 'Ship', icon: null, color: 'success' as const, shared: true, steps: [{ kind: 'archive' as const }] }
    const elsewhere = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13', buttons: [{ ...button, columnIds: ['other'], cardIds: [] }] } })
    expect(elsewhere.find('[aria-label="Card buttons"]').exists()).toBe(false)
    const here = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13', buttons: [{ ...button, columnIds: ['col'], cardIds: [] }] } })
    expect(here.find('[aria-label="Card buttons"]').exists()).toBe(true)
  })
  it('offers a card button added to this card whatever its columns', async () => {
    const button = { id: 'b1', scope: 'card' as const, name: 'Ship', icon: null, color: 'success' as const, shared: true, columnIds: [] as string[], steps: [{ kind: 'archive' as const }] }
    const added = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13', buttons: [{ ...button, cardIds: [card().id] }] } })
    expect(added.find('[aria-label="Card buttons"]').text()).toContain('Ship')
    const other = await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13', buttons: [{ ...button, cardIds: ['other-card'] }] } })
    expect(other.find('[aria-label="Card buttons"]').exists()).toBe(false)
  })
  it('places the card buttons by the board\'s alignment', async () => {
    const buttons = [{ id: 'b1', scope: 'card' as const, name: 'Ship', icon: null, color: 'accent' as const, shared: true, columnIds: null, cardIds: [], steps: [{ kind: 'archive' as const }] }]
    const row = async (buttonAlign?: 'left' | 'center' | 'right' | null) =>
      (await mountSuspended(BoardCard, { props: { card: card(), tags, members, canEdit: true, today: '2026-10-13', buttons, buttonAlign } })).find('[aria-label="Card buttons"]').classes()
    expect(await row()).toContain('justify-start')
    expect(await row(null)).toContain('justify-start')
    expect(await row('center')).toContain('justify-center')
    expect(await row('right')).toContain('justify-end')
  })
})
