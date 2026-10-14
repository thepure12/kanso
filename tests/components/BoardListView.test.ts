import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import BoardListView from '~/components/BoardListView.vue'
import type { BoardField, Card, Column, Member } from '#shared/types/board'

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, columnId: 'c1', title: `Card ${id}`, description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {}, ...over,
})
const columns: Column[] = [
  { id: 'c1', title: 'To do', position: 1, color: null, wipLimit: null, rules: [] },
  { id: 'c2', title: 'Done', position: 2, color: null, wipLimit: null, rules: [] },
]
const members: Member[] = [{ userId: 'u1', name: 'Alice', email: 'a@x', avatarUrl: null, role: 'owner', boardRole: 'owner', teamRole: null }]
const fields: BoardField[] = [
  { id: 'f1', name: 'Customer', kind: 'text', options: [], position: 1, showOnCard: true },
  { id: 'f2', name: 'Secret', kind: 'text', options: [], position: 2, showOnCard: false },
]
const cards = [
  card('b', { priority: 'low', estimate: 2, timeMinutes: 90, assigneeIds: ['u1'], fields: { f1: 'Acme', f2: 'hidden' } }),
  card('a', { priority: 'urgent', columnId: 'c2', dueDate: '2026-10-01' }),
]
const mount = (canEdit = true) =>
  mountSuspended(BoardListView, { props: { cards, columns, members, tags: [], fields, canEdit, today: '2026-10-14' } })
const titles = (w: Awaited<ReturnType<typeof mount>>) => w.findAll('tbody tr').map(r => r.find('td').text())

describe('BoardListView', () => {
  it('shows a row per card with its details and custom fields on cards', async () => {
    const w = await mount()
    expect(titles(w)).toEqual(['Card b', 'Card a'])
    const text = w.text()
    expect(text).toContain('Customer')
    expect(text).toContain('Acme')
    expect(text).not.toContain('Secret')
    expect(text).toContain('1h 30m')
    expect(text).toContain('Alice')
    expect(text).toContain('Urgent')
  })

  it('sorts by a column header: ascending, descending, then board order', async () => {
    const w = await mount()
    const header = () => w.find('[aria-label^="Sort by Priority"]')
    await header().trigger('click')
    expect(titles(w)).toEqual(['Card a', 'Card b'])
    await header().trigger('click')
    expect(titles(w)).toEqual(['Card b', 'Card a'])
    await header().trigger('click')
    expect(titles(w)).toEqual(['Card b', 'Card a'])
    await w.find('[aria-label^="Sort by Title"]').trigger('click')
    expect(titles(w)).toEqual(['Card a', 'Card b'])
  })

  it('opens a card from its title', async () => {
    const w = await mount()
    await w.findAll('tbody button').find(b => b.text() === 'Card a')!.trigger('click')
    expect(w.emitted('open')).toEqual([['a']])
  })

  it('offers a status select to editors only', async () => {
    const w = await mount()
    expect(w.find('[aria-label="Status of Card b"]').exists()).toBe(true)
    const viewer = await mount(false)
    expect(viewer.find('[aria-label="Status of Card b"]').exists()).toBe(false)
    expect(viewer.text()).toContain('Done')
  })
})
