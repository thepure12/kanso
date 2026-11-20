import { eq } from 'drizzle-orm'

/** Deletes an assignee group; cards keep their assignees. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { assigneeGroups: g } = schema
  const rows = await tx.delete(g).where(eq(g.id, id)).returning({ id: g.id })
  if (!rows.length) notFound('Assignee group not found or not allowed')
  return { ok: true }
})
