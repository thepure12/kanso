import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { columnRules } = schema
  const rows = await tx.delete(columnRules).where(eq(columnRules.id, id)).returning({ id: columnRules.id })
  if (!rows.length) notFound('Rule not found or not allowed')
  return { ok: true }
})
