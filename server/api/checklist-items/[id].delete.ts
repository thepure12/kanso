import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { checklistItems: ci } = schema
  const rows = await tx.delete(ci).where(eq(ci.id, id)).returning({ id: ci.id })
  if (!rows.length) notFound('Checklist item not found or not allowed')
  return { ok: true }
})
