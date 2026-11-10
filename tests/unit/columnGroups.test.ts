import { describe, expect, it } from 'vitest'
import { columnsInGroup, groupsForColumn, toggleColumn } from '../../app/utils/columnGroups'

const columns = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const dev = { id: 'dev', columnIds: ['c', 'a'] }
const qa = { id: 'qa', columnIds: ['b', 'c'] }

describe('column groups', () => {
  it('shows a group in board order, or every column without one', () => {
    expect(columnsInGroup(columns, dev).map(c => c.id)).toEqual(['a', 'c'])
    expect(columnsInGroup(columns, null)).toBe(columns)
    expect(columnsInGroup(columns, { columnIds: [] })).toEqual([])
  })

  it('lists the groups of a column', () => {
    expect(groupsForColumn([dev, qa], 'c').map(g => g.id)).toEqual(['dev', 'qa'])
    expect(groupsForColumn([dev, qa], 'b').map(g => g.id)).toEqual(['qa'])
  })

  it('toggles a column without duplicates', () => {
    expect(toggleColumn(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleColumn(['a', 'b'], 'b', true)).toEqual(['a', 'b'])
    expect(toggleColumn(['a', 'b'], 'a', false)).toEqual(['b'])
  })
})
