import { eq } from 'drizzle-orm'

/** Deletes a column group; its columns stay. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { columnGroups: g } = schema
  const rows = await tx.delete(g).where(eq(g.id, id)).returning({ id: g.id })
  if (!rows.length) notFound('Column group not found or not allowed')
  return { ok: true }
})
