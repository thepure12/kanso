import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardRecurrences: r } = schema
  const rows = await tx.delete(r).where(eq(r.templateCardId, id)).returning({ id: r.id })
  if (!rows.length) notFound('Schedule not found or not allowed')
  return { ok: true }
})
