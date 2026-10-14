import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { timeEntries: te } = schema
  // RLS: the person who logged it or a board owner.
  const rows = await tx.delete(te).where(eq(te.id, id)).returning({ id: te.id })
  if (!rows.length) notFound('Time entry not found or not allowed')
  return { ok: true }
})
