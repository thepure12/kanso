import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { webhookFormats } from '#shared/webhooks'
import type { BoardWebhook } from '#shared/types/webhooks'

const body = z.object({
  url: webhookUrlSchema.optional(),
  format: z.enum(webhookFormats).optional(),
  events: webhookEventsSchema.optional(),
  active: z.boolean().optional(),
}).refine(b => Object.values(b).some(v => v !== undefined), 'Nothing to update')

/** Edits or turns a webhook on/off (board_webhooks_update: owners). Turning it on resets the failure count. */
export default defineUserHandler(async (event, tx): Promise<BoardWebhook> => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  const w = schema.boardWebhooks
  const [row] = await tx.update(w).set(patch).where(eq(w.id, id)).returning(webhookColumns)
  return row ? toBoardWebhook(row) : notFound('Webhook not found')
})
