import { describe, expect, it } from 'vitest'
import type { Card, CardLink } from '#shared/types/board'
import { blockedCardIds, groupLinks } from '../../app/utils/cardLinks'
import { serverI18n } from '../../server/utils/i18n'

const card = (id: string, columnId: string, blockerIds: string[] = []) => ({ id, columnId, blockerIds }) as Card
const columns = [{ id: 'todo' }, { id: 'doing' }, { id: 'done' }]

describe('blockedCardIds', () => {
  it('counts blockers that are on the board and not in the last column', () => {
    const cards = [
      card('a', 'todo'),
      card('b', 'done'),
      card('open', 'todo', ['a']),
      card('doneBlocker', 'doing', ['b']),
      card('archivedBlocker', 'doing', ['gone']),
      card('mixed', 'todo', ['b', 'a']),
    ]
    expect([...blockedCardIds(cards, columns)].sort()).toEqual(['mixed', 'open'])
  })

  it('treats the only column as done', () => {
    expect(blockedCardIds([card('a', 'todo'), card('b', 'todo', ['a'])], [{ id: 'todo' }]).size).toBe(0)
  })
})

describe('groupLinks', () => {
  const link = (id: string, kind: CardLink['kind'], direction: CardLink['direction']) =>
    ({ id, kind, direction, card: { id, title: id, columnId: 'c', columnTitle: 'C', archived: false } }) as CardLink

  it('groups by kind and direction in a fixed order', () => {
    const groups = groupLinks([link('1', 'relates', 'in'), link('2', 'blocks', 'in'), link('3', 'blocks', 'out'), link('4', 'relates', 'out'), link('5', 'duplicates', 'in')], serverI18n('en').t)
    expect(groups.map(g => [g.label, g.links.map(l => l.id)])).toEqual([
      ['Blocks', ['3']], ['Blocked by', ['2']], ['Relates to', ['1', '4']], ['Duplicated by', ['5']],
    ])
  })
})
