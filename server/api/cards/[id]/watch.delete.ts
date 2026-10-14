import { and, eq } from 'drizzle-orm'

/** Stops watching the card. Idempotent. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  await cardBoardId(tx, id)
  const { cardWatchers: cw } = schema
  await tx.delete(cw).where(and(eq(cw.cardId, id), eq(cw.userId, userId)))
  return { watching: false }
})
