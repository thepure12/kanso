import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { webhookFormats } from '#shared/webhooks'
import type { BoardWebhook } from '#shared/types/webhooks'

const body = z.object({
  url: webhookUrlSchema,
  format: z.enum(webhookFormats).default('json'),
  events: webhookEventsSchema.default([]),
})

/**
 * Adds a webhook (board_webhooks_insert: owners). The signing secret is
 * generated here and returned in this response only.
 */
export default defineUserHandler(async (event, tx, userId): Promise<BoardWebhook & { secret: string }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const values = await readValidated(event, body)
  const secret = randomBytes(32).toString('hex')
  const [row] = await tx.insert(schema.boardWebhooks)
    .values({ ...values, boardId: id, secret, createdBy: userId })
    .returning(webhookColumns)
  return { ...toBoardWebhook(row!), secret }
})
