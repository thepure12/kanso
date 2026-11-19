import { describe, expect, it } from 'vitest'
import type { BoardSummary } from '#shared/types/board'
import { boardsOutsideTeams } from '../../app/utils/homeBoards'

const board = (id: string, teamId: string | null) => ({ id, teamId }) as BoardSummary

describe('boardsOutsideTeams', () => {
  it('keeps personal boards and boards of teams the user is not in', () => {
    const boards = [board('a', null), board('b', 't1'), board('c', 't2')]
    expect(boardsOutsideTeams(boards, ['t1']).map(b => b.id)).toEqual(['a', 'c'])
  })

  it('lists every team board when the user is in no team', () => {
    const boards = [board('b', 't1')]
    expect(boardsOutsideTeams(boards, []).map(b => b.id)).toEqual(['b'])
  })
})
