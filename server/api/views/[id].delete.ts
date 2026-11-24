import { eq } from 'drizzle-orm'

/** Deletes a custom view of the caller's. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { customViews: v } = schema
  const rows = await tx.delete(v).where(eq(v.id, id)).returning({ id: v.id })
  if (!rows.length) notFound('View not found')
  return { ok: true }
})
