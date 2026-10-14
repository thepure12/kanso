import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardLinks } = schema
  // RLS: editors and owners of the board.
  const rows = await tx.delete(cardLinks).where(eq(cardLinks.id, id)).returning({ id: cardLinks.id })
  if (!rows.length) notFound('Link not found or not allowed')
  return { ok: true }
})
