import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const r = schema.boardAgentRules
  const rows = await tx.delete(r).where(eq(r.id, id)).returning({ id: r.id })
  if (!rows.length) notFound('Agent rule not found or not allowed')
  return { ok: true }
})
