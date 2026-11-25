import { describe, expect, it } from 'vitest'
import { reorderViewColumnIds } from '../../app/utils/customViews'

describe('reorderViewColumnIds', () => {
  it('puts the shown columns in their new order', () => {
    expect(reorderViewColumnIds(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })

  it('keeps columns that are not shown in their slots', () => {
    expect(reorderViewColumnIds(['a', 'x', 'b', 'c'], ['c', 'b', 'a'])).toEqual(['c', 'x', 'b', 'a'])
  })
})
