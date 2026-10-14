import { asc, eq } from 'drizzle-orm'
import type { BoardWebhook } from '#shared/types/webhooks'

/** The board's webhooks (board_webhooks_select: owners only; others get an empty list). */
export default defineUserHandler(async (event, tx): Promise<BoardWebhook[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  const w = schema.boardWebhooks
  const rows = await tx.select(webhookColumns).from(w).where(eq(w.boardId, id)).orderBy(asc(w.createdAt))
  return rows.map(toBoardWebhook)
})
