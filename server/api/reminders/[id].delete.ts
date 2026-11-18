import { eq } from 'drizzle-orm'

/** Deletes one of the caller's reminders (RLS: own rows only). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const r = schema.cardReminders
  const rows = await tx.delete(r).where(eq(r.id, id)).returning({ id: r.id })
  if (!rows.length) notFound('Reminder not found')
  return { ok: true }
})
