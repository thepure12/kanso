import { eq } from 'drizzle-orm'

/** Deletes a field and every card's value for it. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { boardFields: f } = schema
  const rows = await tx.delete(f).where(eq(f.id, id)).returning({ id: f.id })
  if (!rows.length) notFound('Field not found or not allowed')
  return { ok: true }
})
