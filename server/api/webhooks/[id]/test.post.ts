import { sql } from 'drizzle-orm'
import type { WebhookFormat } from '#shared/webhooks'
import type { WebhookTestResult } from '#shared/types/webhooks'

/** Sends a test ping now and returns the outcome (app.webhook_ping_target: owners only). */
export default defineUserHandler(async (event, tx): Promise<WebhookTestResult> => {
  const { id } = await paramsValidated(event, uuidParam)
  const [t] = await tx.execute<{ url: string, format: WebhookFormat, secret: string, board_id: string, board_name: string, locale: string | null }>(
    sql`select * from app.webhook_ping_target(${id})`)
  if (!t) notFound('Webhook not found')
  return pingWebhook(id, { url: t.url, format: t.format, secret: t.secret, boardId: t.board_id, boardName: t.board_name, locale: t.locale })
})
