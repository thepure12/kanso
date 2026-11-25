import { eq } from 'drizzle-orm'
import type { GitSyncResult } from '#shared/types/gitLinks'

/**
 * Imports the link's new issues now. The caller must see the link
 * (board_git_links_select: owners) and it must be on; the import itself runs
 * as for the task (kanban_auth, automation mode), after this check's
 * transaction, and its cards reach the board through the live update.
 */
export default defineUserHandler(async (event, tx): Promise<GitSyncResult> => {
  const { id } = await paramsValidated(event, uuidParam)
  const g = schema.boardGitLinks
  const [row] = await tx.select({ id: g.id, active: g.active }).from(g).where(eq(g.id, id))
  if (!row) notFound('Repository link not found')
  if (!row.active) throw createError({ statusCode: 409, statusMessage: 'This repository link is turned off' })
  const result = (await syncGitLinks({ onlyLink: id })).get(id)
  // Archived board (claim skips it) or a sync running elsewhere right now.
  return result ?? { imported: 0, completed: 0, error: null }
})
