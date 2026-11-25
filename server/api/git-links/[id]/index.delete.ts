import { eq } from 'drizzle-orm'

/** Unlinks a repository (board_git_links_delete: owners). Imported cards stay. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const g = schema.boardGitLinks
  const [row] = await tx.delete(g).where(eq(g.id, id)).returning({ id: g.id })
  if (!row) notFound('Repository link not found')
  return { ok: true }
})
