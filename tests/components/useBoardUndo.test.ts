import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref, toRaw } from 'vue'
import type { BoardDetail, Card } from '#shared/types/board'
import { blockedCardIds, blockingCardIds } from '../../app/utils/cardLinks'

// useBoard with the network mocked: checks which requests undo sends.
const m = vi.hoisted(() => ({
  api: vi.fn(),
  refresh: vi.fn(),
  toastAdd: vi.fn(() => ({ id: 1 })),
  board: null as unknown,
}))
mockNuxtImport('api', () => m.api)
mockNuxtImport('useFetch', () => () => ({ data: m.board, error: { value: null }, refresh: m.refresh }))
mockNuxtImport('useToast', () => () => ({ add: m.toastAdd, remove: vi.fn() }))

const card = (id: string, columnId: string): Card => ({
  id, columnId, title: id, description: '', position: 1,
  assigneeIds: [], tagIds: [], startDate: null, dueDate: null, priority: null, estimate: null, coverAttachmentId: null,
  checklist: { done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, timeMinutes: 0, watching: false, blockerIds: [], fields: {},
})
const column = (id: string) => ({ id, title: id, position: 1, color: null, wipLimit: null, rules: [] })

type Board = Awaited<ReturnType<typeof useBoard>>
async function mountBoard() {
  let b!: Board
  const Harness = defineComponent({
    async setup() {
      b = await useBoard('board')
      return () => h('div')
    },
  })
  await mountSuspended(Harness)
  return b
}

/** [url, method, body] of each api call since the last reset. */
const calls = () => m.api.mock.calls.map(([url, opts]) => [url, opts?.method, opts?.body])
const ids = (b: Board, col: string) => b.lists.value[col]!.map(c => c.id)

beforeEach(() => {
  vi.stubGlobal('EventSource', class { addEventListener() {} close() {} })
  m.api.mockReset().mockResolvedValue({})
  m.refresh.mockReset()
  m.toastAdd.mockClear()
  m.board = ref({
    id: 'board', name: 'B', role: 'owner', archivedAt: null, team: null, members: [],
    columns: [column('c1'), column('c2')],
    cards: [card('a', 'c1'), card('b', 'c1'), card('x', 'c2')],
    tags: [], fields: [], columnGroups: [], assigneeGroups: [], savedViews: [], buttons: [], templates: [], recurrences: [], automations: [], rules: [], agentRules: [], scheduledActions: [],
  } as unknown as BoardDetail)
})

describe('useBoard undo', () => {
  it('moves a card back next to its old neighbours, and redoes the move', async () => {
    const b = await mountBoard()
    await b.moveCard(b.lists.value.c1![0]!, 'c2')
    expect(ids(b, 'c2')).toEqual(['x', 'a'])
    expect(m.toastAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Moved card' }))

    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/a/move', 'POST', { columnId: 'c1', aboveId: null, belowId: 'b' }]])
    expect(ids(b, 'c1')).toEqual(['a', 'b'])
    expect(ids(b, 'c2')).toEqual(['x'])

    m.api.mockClear()
    await b.redo()
    expect(calls()).toEqual([['/api/cards/a/move', 'POST', { columnId: 'c2', aboveId: 'x', belowId: null }]])
  })

  it('undoes a drag using the order from when the drag started', async () => {
    const b = await mountBoard()
    b.dragging.value = true
    b.lists.value.c1 = [b.lists.value.c1![1]!, b.lists.value.c1![0]!] // b dragged above a
    b.dragging.value = false
    await nextTick()
    await b.cardMoved('c1', 0)
    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/b/move', 'POST', { columnId: 'c1', aboveId: 'a', belowId: null }]])
    expect(ids(b, 'c1')).toEqual(['a', 'b'])
  })

  it('takes the other selected cards along on a drag, saved in order, undone as one step', async () => {
    const b = await mountBoard()
    b.dragging.value = true
    // b dragged from c1 to below x; a (above it in the board) is selected too.
    const dragged = b.lists.value.c1![1]!
    b.lists.value.c1 = [b.lists.value.c1![0]!]
    b.lists.value.c2 = [b.lists.value.c2![0]!, dragged]
    b.dragging.value = false
    await nextTick()
    await b.cardsMoved('c2', 1, ['a'])
    expect(ids(b, 'c1')).toEqual([])
    expect(ids(b, 'c2')).toEqual(['x', 'a', 'b'])
    expect(calls()).toEqual([
      ['/api/cards/a/move', 'POST', { columnId: 'c2', aboveId: 'x', belowId: null }],
      ['/api/cards/b/move', 'POST', { columnId: 'c2', aboveId: 'a', belowId: null }],
    ])
    expect(m.toastAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Moved 2 cards' }))

    m.api.mockClear()
    await b.undo()
    expect(ids(b, 'c1')).toEqual(['a', 'b'])
    expect(ids(b, 'c2')).toEqual(['x'])
  })

  it('unarchives an archived card and reloads the board', async () => {
    const b = await mountBoard()
    await b.archiveCard(b.lists.value.c1![0]!)
    expect(ids(b, 'c1')).toEqual(['b'])
    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/a', 'PATCH', { archived: false }]])
    expect(m.refresh).toHaveBeenCalled()
  })

  it('wakes a snoozed card and reloads the board', async () => {
    const b = await mountBoard()
    await b.snoozeCard(b.lists.value.c1![0]!, '2099-01-01')
    expect(ids(b, 'c1')).toEqual(['b'])
    expect(calls()).toContainEqual(['/api/cards/a', 'PATCH', { snoozedUntil: '2099-01-01' }])
    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/a', 'PATCH', { snoozedUntil: null }]])
    expect(m.refresh).toHaveBeenCalled()
  })

  it('marks a card complete and undoes it', async () => {
    const b = await mountBoard()
    const a = b.lists.value.c1![0]!
    await b.setCardCompleted(a, true)
    expect(a.completedAt).toBeTruthy()
    expect(calls()).toContainEqual(['/api/cards/a', 'PATCH', { completed: true }])
    expect(m.toastAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Marked card complete' }))
    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/a', 'PATCH', { completed: false }]])
    expect(a.completedAt).toBeNull()
  })

  it('lifts a block when the blocker is marked complete and puts it back on undo', async () => {
    const detail = (m.board as { value: BoardDetail }).value
    detail.cards[1]!.blockerIds = ['a'] // a blocks b
    detail.columns.push(column('c3') as BoardDetail['columns'][number]) // c2 is no longer the done column
    const b = await mountBoard()
    const blocked = computed(() => [...blockedCardIds(Object.values(b.lists.value).flat(), b.columns.value)])
    const blocking = computed(() => [...blockingCardIds(Object.values(b.lists.value).flat(), b.columns.value)])
    expect(blocked.value).toEqual(['b'])
    expect(blocking.value).toEqual(['a'])
    const a = b.lists.value.c1![0]!
    m.api.mockResolvedValueOnce({ ...a, completedAt: '2026-11-25T00:00:00.000Z' })
    await b.setCardCompleted(a, true)
    expect(blocked.value).toEqual([])
    expect(blocking.value).toEqual([])
    m.api.mockResolvedValueOnce({ ...a, completedAt: null })
    await b.undo()
    expect(blocked.value).toEqual(['b'])
    expect(blocking.value).toEqual(['a'])
  })

  it('patches the previous values of an edit', async () => {
    const b = await mountBoard()
    const a = b.lists.value.c1![0]!
    await b.updateCard(a, { title: 'a', priority: 'high' }) // title unchanged
    expect(m.toastAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Changed priority' }))
    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/a', 'PATCH', { priority: null }]])
    expect(a.priority).toBeNull()
  })

  it('reports a rejected undo and reloads', async () => {
    const b = await mountBoard()
    await b.archiveCard(b.lists.value.c1![0]!)
    m.api.mockRejectedValueOnce(Object.assign(new Error('Not found'), { statusCode: 404 }))
    await b.undo()
    expect(m.toastAdd).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Couldn\'t undo' }))
    expect(m.refresh).toHaveBeenCalled()
    expect(b.canUndo.value).toBe(false)
  })
})

describe('useBoard reload', () => {
  // useFetch's transform (shareStructure) keeps unchanged objects; the watcher keeps lists whose items stayed.
  const reload = async (b: Board, change: (d: BoardDetail) => BoardDetail) => {
    const data = m.board as { value: BoardDetail }
    data.value = change(toRaw(data.value))
    await nextTick()
    return b
  }

  it('keeps the arrays of columns whose cards did not change', async () => {
    const b = await mountBoard()
    const c1 = b.lists.value.c1
    const c2 = b.lists.value.c2
    const tags = b.tags.value
    await reload(b, d => ({ ...d, cards: [d.cards[0]!, d.cards[1]!, { ...d.cards[2]!, title: 'x2' }] }))
    expect(b.lists.value.c1).toBe(c1)
    expect(b.lists.value.c2).not.toBe(c2)
    expect(b.lists.value.c2![0]!.title).toBe('x2')
    expect(b.tags.value).toBe(tags)
  })

  it('still resets a list that a local change left out of step', async () => {
    const b = await mountBoard()
    b.lists.value.c1 = [b.lists.value.c1![1]!, b.lists.value.c1![0]!]
    await reload(b, d => ({ ...d }))
    expect(ids(b, 'c1')).toEqual(['a', 'b'])
  })
})
