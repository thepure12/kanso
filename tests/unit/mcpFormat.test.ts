import { describe, expect, it } from 'vitest'
import type { BoardDetail, Card } from '#shared/types/board'
import { boardForAgent } from '../../server/utils/mcpFormat'

const card = (id: string, columnId: string, blockerIds: string[] = []) =>
  ({ id, title: id, columnId, blockerIds, tagIds: [], assigneeIds: [], checklist: { done: 0, total: 0 }, commentCount: 0, fields: {} }) as unknown as Card

describe('boardForAgent', () => {
  it('marks blocked cards and the open cards that block them', () => {
    const board = {
      columns: [{ id: 'todo', title: 'To do' }, { id: 'done', title: 'Done' }],
      cards: [card('a', 'todo'), card('b', 'todo', ['a']), card('c', 'done', ['a']), card('d', 'done'), card('e', 'todo', ['d'])],
      tags: [], members: [], columnGroups: [], assigneeGroups: [], fields: [], templates: [], team: null, archivedAt: null,
    } as unknown as BoardDetail
    const cards = boardForAgent(board).columns.flatMap(c => c.cards)
    const flags = Object.fromEntries(cards.map(c => [c.id, [c.blocked ?? false, c.blocks ?? false]]))
    expect(flags).toEqual({ a: [false, true], b: [true, false], c: [true, false], d: [false, false], e: [false, false] })
  })
})
