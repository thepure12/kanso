import { asc, eq } from 'drizzle-orm'
import type { BoardGitLink } from '#shared/types/gitLinks'

/** The board's linked GitHub repositories (board_git_links_select: owners only; others get an empty list). */
export default defineUserHandler(async (event, tx): Promise<BoardGitLink[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  const g = schema.boardGitLinks
  const rows = await tx.select(gitLinkColumns).from(g).where(eq(g.boardId, id)).orderBy(asc(g.createdAt))
  return rows.map(toBoardGitLink)
})
