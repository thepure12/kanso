import { describe, expect, it } from 'vitest'
import { parseCollapsedColumns, pruneCollapsedColumns } from '../../app/utils/collapsedColumns'

describe('collapsed columns', () => {
  it('parses stored ids, ignoring bad data', () => {
    expect(parseCollapsedColumns(null)).toEqual([])
    expect(parseCollapsedColumns('not json')).toEqual([])
    expect(parseCollapsedColumns('{"a":1}')).toEqual([])
    expect(parseCollapsedColumns('["a", 2, "", "b", "a"]')).toEqual(['a', 'b'])
  })

  it('prunes columns that no longer exist', () => {
    expect(pruneCollapsedColumns(['a', 'gone', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b'])
  })
})
