import { describe, expect, it } from 'vitest'
import { BOARD_TABS_MAX, closeBoardTab, openBoardTab, parseBoardTabs, serializeBoardTabs, stepBoardTab } from '../../app/utils/boardTabs'

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
    expect(closeBoardTab([a, b, c], 'b')).toEqual({ tabs: [a, c], next: 'c' })
    expect(closeBoardTab([a, b, c], 'c')).toEqual({ tabs: [a, b], next: 'b' })
    expect(closeBoardTab([a], 'a')).toEqual({ tabs: [], next: null })
    expect(closeBoardTab([a], 'x')).toEqual({ tabs: [a], next: null })
  })

  it('steps through tabs, wrapping around', () => {
    expect(stepBoardTab([a, b, c], 'c', 1)).toBe('a')
    expect(stepBoardTab([a, b, c], 'a', -1)).toBe('c')
    expect(stepBoardTab([a], 'a', 1)).toBeNull()
    expect(stepBoardTab([a, b], 'x', 1)).toBeNull()
  })
})
