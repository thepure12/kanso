import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const rows = await tx.delete(schema.columns).where(eq(schema.columns.id, id)).returning({ id: schema.columns.id })
  if (!rows.length) notFound('Column not found or not allowed')
  return { ok: true }
})
