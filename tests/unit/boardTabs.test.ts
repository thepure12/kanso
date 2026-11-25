import { describe, expect, it } from 'vitest'
import { BOARD_TABS_MAX, boardTabPath, closeBoardTab, moveBoardTab, openBoardTab, parseBoardTabs, reorderBoardTabs, serializeBoardTabs, stepBoardTab } from '../../app/utils/boardTabs'

const a = { id: 'a', name: 'A' }
const b = { id: 'b', name: 'B' }
const c = { id: 'c', name: 'C' }

describe('board tabs', () => {
  it('reads only the same user\'s tabs and drops bad entries', () => {
    const raw = serializeBoardTabs([a, b], 'u1')
    expect(parseBoardTabs(raw, 'u1')).toEqual([a, b])
    expect(parseBoardTabs(raw, 'u2')).toEqual([])
    expect(parseBoardTabs(null, 'u1')).toEqual([])
    expect(parseBoardTabs('nope', 'u1')).toEqual([])
    expect(parseBoardTabs(JSON.stringify({ userId: 'u1', tabs: [a, { id: 1 }, null, a, b] }), 'u1')).toEqual([a, b])
  })

  it('keeps custom view tabs apart from board tabs', () => {
    const v = { id: 'v', name: 'V', kind: 'view' as const }
    const raw = serializeBoardTabs([a, v], 'u1')
    expect(parseBoardTabs(raw, 'u1')).toEqual([a, v])
    expect(parseBoardTabs(JSON.stringify({ userId: 'u1', tabs: [{ id: 'x', name: 'X', kind: 'other' }] }), 'u1')).toEqual([{ id: 'x', name: 'X' }])
    expect(boardTabPath(a)).toBe('/boards/a')
    expect(boardTabPath(v)).toBe('/views/v')
    expect(openBoardTab([a, v], v)).toEqual([a, v])
    expect(stepBoardTab([a, v], 'a', 1)).toBe(v)
  })

  it('opens new tabs at the end and renames known ones in place', () => {
    const tabs = [a, b]
    expect(openBoardTab(tabs, c)).toEqual([a, b, c])
    expect(openBoardTab(tabs, { id: 'a', name: 'A2' })).toEqual([{ id: 'a', name: 'A2' }, b])
    expect(openBoardTab(tabs, a)).toBe(tabs)
  })

  it('drops the first tabs past the limit', () => {
    const many = Array.from({ length: BOARD_TABS_MAX }, (_, i) => ({ id: `t${i}`, name: `T${i}` }))
    const next = openBoardTab(many, c)
    expect(next).toHaveLength(BOARD_TABS_MAX)
    expect(next[0]!.id).toBe('t1')
    expect(next.at(-1)).toEqual(c)
  })

  it('closes a tab and picks its right neighbour, else the left one', () => {
    expect(closeBoardTab([a, b, c], 'b')).toEqual({ tabs: [a, c], next: c })
    expect(closeBoardTab([a, b, c], 'c')).toEqual({ tabs: [a, b], next: b })
    expect(closeBoardTab([a], 'a')).toEqual({ tabs: [], next: null })
    expect(closeBoardTab([a], 'x')).toEqual({ tabs: [a], next: null })
  })

  it('steps through tabs, wrapping around', () => {
    expect(stepBoardTab([a, b, c], 'c', 1)).toBe(a)
    expect(stepBoardTab([a, b, c], 'a', -1)).toBe(c)
    expect(stepBoardTab([a], 'a', 1)).toBeNull()
    expect(stepBoardTab([a, b], 'x', 1)).toBeNull()
  })

  it('reorders tabs by id, keeping tabs missing from the list at the end', () => {
    const tabs = [a, b, c]
    expect(reorderBoardTabs(tabs, ['c', 'a', 'b'])).toEqual([c, a, b])
    expect(reorderBoardTabs(tabs, ['b', 'x', 'b', 'a'])).toEqual([b, a, c])
    expect(reorderBoardTabs(tabs, ['a', 'b', 'c'])).toBe(tabs)
  })

  it('moves a tab left or right, stopping at the ends', () => {
    const tabs = [a, b, c]
    expect(moveBoardTab(tabs, 'a', 1)).toEqual([b, a, c])
    expect(moveBoardTab(tabs, 'c', -2)).toEqual([c, a, b])
    expect(moveBoardTab(tabs, 'b', 5)).toEqual([a, c, b])
    expect(moveBoardTab(tabs, 'a', -1)).toBe(tabs)
    expect(moveBoardTab(tabs, 'x', 1)).toBe(tabs)
  })
})
