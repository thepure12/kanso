import { eq } from 'drizzle-orm'

/** Unlinks the card from its Matrix thread (card_matrix_threads_delete: editors). Nothing is deleted in Matrix. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const t = schema.cardMatrixThreads
  const rows = await tx.delete(t).where(eq(t.cardId, id)).returning({ cardId: t.cardId })
  if (!rows.length) notFound('The card has no Matrix thread')
  return { ok: true }
})
