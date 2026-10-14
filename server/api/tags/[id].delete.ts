import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const rows = await tx.delete(schema.tags).where(eq(schema.tags.id, id)).returning({ id: schema.tags.id })
  if (!rows.length) notFound('Tag not found or not allowed')
  return { ok: true }
})
