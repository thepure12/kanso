import { describe, expect, it } from 'vitest'
import type { SavedViewConfig } from '../../shared/savedViews'
import type { BoardField } from '../../shared/types/board'
import { currentViewConfig, sameViewConfig, sanitizeViewConfig, sortSavedViews } from '../../app/utils/savedViews'
import { emptyFilter } from '../../app/utils/cardFilter'

const select: BoardField = { id: 'f1', name: 'Team', kind: 'select', options: [{ id: 'o1', label: 'A', color: null }], position: 1, showOnCard: false } as BoardField
const checkbox: BoardField = { id: 'f2', name: 'Done', kind: 'checkbox', options: [], position: 2, showOnCard: false }
const text: BoardField = { id: 'f3', name: 'Notes', kind: 'text', options: [], position: 3, showOnCard: false }

const ctx = {
  tags: [{ id: 't1' }],
  members: [{ userId: 'u1' }],
  fields: [select, checkbox, text],
  columnGroups: [{ id: 'g1' }],
}

const base = (): SavedViewConfig => currentViewConfig({ view: 'board', groupBy: 'none', columnGroupId: null, filter: emptyFilter() })

describe('currentViewConfig', () => {
  it('copies the state, trims text and drops empty field filters', () => {
    const filter = { ...emptyFilter(), text: '  bug ', tagIds: ['t1'], fields: { f1: ['o1'], f2: [] } }
    const c = currentViewConfig({ view: 'list', groupBy: 'tag', columnGroupId: 'g1', filter })
    expect(c).toEqual({ view: 'list', groupBy: 'tag', columnGroupId: 'g1', filter: { ...emptyFilter(), text: 'bug', tagIds: ['t1'], fields: { f1: ['o1'] } } })
    filter.tagIds.push('t2')
    expect(c.filter.tagIds).toEqual(['t1'])
  })
})

describe('sanitizeViewConfig', () => {
  it('drops what the board no longer has', () => {
    const c: SavedViewConfig = {
      view: 'board',
      groupBy: 'field:gone',
      columnGroupId: 'g2',
      filter: {
        text: 'x', tagIds: ['t1', 't9'], assigneeIds: ['u1', 'u9', 'none'], priorities: ['high'], due: 'week',
        fields: { f1: ['o1', 'o9', 'none'], f2: ['true', 'o1'], f3: ['x'], gone: ['o1'] },
      },
    }
    expect(sanitizeViewConfig(c, ctx)).toEqual({
      view: 'board',
      groupBy: 'none',
      columnGroupId: null,
      filter: { text: 'x', tagIds: ['t1'], assigneeIds: ['u1', 'none'], priorities: ['high'], due: 'week', fields: { f1: ['o1', 'none'], f2: ['true'] } },
    })
  })

  it('keeps valid grouping and column group', () => {
    const c = { ...base(), groupBy: 'field:f1', columnGroupId: 'g1' }
    expect(sanitizeViewConfig(c, ctx)).toMatchObject({ groupBy: 'field:f1', columnGroupId: 'g1' })
  })
})

describe('sameViewConfig', () => {
  it('ignores list order and empty field filters', () => {
    const a = { ...base(), filter: { ...base().filter, tagIds: ['a', 'b'], fields: { f1: ['o1'] } } }
    const b = { ...base(), filter: { ...base().filter, tagIds: ['b', 'a'], fields: { f1: ['o1'], f2: [] } } }
    expect(sameViewConfig(a, b)).toBe(true)
  })

  it('notices differences', () => {
    expect(sameViewConfig(base(), { ...base(), view: 'list' })).toBe(false)
    expect(sameViewConfig(base(), { ...base(), filter: { ...base().filter, due: 'today' } })).toBe(false)
    expect(sameViewConfig(base(), { ...base(), filter: { ...base().filter, fields: { f1: ['o1'] } } })).toBe(false)
  })
})

it('sortSavedViews sorts by name case-insensitively', () => {
  expect(sortSavedViews([{ name: 'b' }, { name: 'A' }, { name: 'c' }]).map(v => v.name)).toEqual(['A', 'b', 'c'])
})
