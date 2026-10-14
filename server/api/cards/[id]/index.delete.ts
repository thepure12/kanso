import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const rows = await tx.delete(schema.cards).where(eq(schema.cards.id, id)).returning({ id: schema.cards.id })
  if (!rows.length) notFound('Card not found or not allowed')
  return { ok: true }
})
