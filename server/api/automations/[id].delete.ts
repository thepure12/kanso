import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const a = schema.boardAutomations
  const rows = await tx.delete(a).where(eq(a.id, id)).returning({ id: a.id })
  if (!rows.length) notFound('Automation not found or not allowed')
  return { ok: true }
})
