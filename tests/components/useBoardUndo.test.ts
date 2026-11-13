import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { BoardDetail, Card } from '#shared/types/board'

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
    tags: [], fields: [], columnGroups: [], savedViews: [], templates: [], recurrences: [], automations: [],
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

  it('unarchives an archived card and reloads the board', async () => {
    const b = await mountBoard()
    await b.archiveCard(b.lists.value.c1![0]!)
    expect(ids(b, 'c1')).toEqual(['b'])
    m.api.mockClear()
    await b.undo()
    expect(calls()).toEqual([['/api/cards/a', 'PATCH', { archived: false }]])
    expect(m.refresh).toHaveBeenCalled()
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
