import { describe, expect, it } from 'vitest'
import { checklistCounts } from '../../app/utils/checklists'

const item = (id: string, done: boolean) => ({ id, checklistId: 'l', text: id, done, position: 0 })

describe('checklistCounts', () => {
  it('sums items over every checklist', () => {
    expect(checklistCounts([
      { id: 'a', name: 'A', position: 1, items: [item('1', true), item('2', false)] },
      { id: 'b', name: 'B', position: 2, items: [item('3', true)] },
      { id: 'c', name: 'C', position: 3, items: [] },
    ])).toEqual({ done: 2, total: 3 })
  })
  it('is zero without checklists', () => {
    expect(checklistCounts([])).toEqual({ done: 0, total: 0 })
  })
})
