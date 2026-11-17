import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const s = schema.cardScheduledActions
  const rows = await tx.delete(s).where(eq(s.id, id)).returning({ id: s.id })
  if (!rows.length) notFound('Scheduled action not found or not allowed')
  return { ok: true }
})
