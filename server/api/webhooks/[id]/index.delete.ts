import { eq } from 'drizzle-orm'

/** Deletes a webhook and its queued deliveries (board_webhooks_delete: owners). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const w = schema.boardWebhooks
  const [row] = await tx.delete(w).where(eq(w.id, id)).returning({ id: w.id })
  if (!row) notFound('Webhook not found')
  return { ok: true }
})
