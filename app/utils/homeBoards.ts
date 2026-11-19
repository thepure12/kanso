import type { BoardSummary } from '#shared/types/board'

/**
 * Boards for the home page's "Personal and shared with you" section: personal
 * boards plus team boards of teams the user is not in (shared with them
 * directly), which no team section lists.
 */
export function boardsOutsideTeams(boards: BoardSummary[], teamIds: Iterable<string>): BoardSummary[] {
  const mine = new Set(teamIds)
  return boards.filter(b => !b.teamId || !mine.has(b.teamId))
}
