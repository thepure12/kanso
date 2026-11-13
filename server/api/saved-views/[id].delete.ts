import { eq } from 'drizzle-orm'

/** Deletes a saved view. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { savedViews: v } = schema
  const rows = await tx.delete(v).where(eq(v.id, id)).returning({ id: v.id })
  if (!rows.length) notFound('Saved view not found or not allowed')
  return { ok: true }
})
