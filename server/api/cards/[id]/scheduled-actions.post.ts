import { z } from 'zod'
import { priorities, type ScheduledCardAction } from '#shared/types/board'

const runOn = z.iso.date()
const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), runOn, targetColumnId: z.uuid() }),
  z.object({ kind: z.literal('archive'), runOn }),
  z.object({ kind: z.literal('priority'), runOn, priority: z.enum(priorities) }),
  z.object({ kind: z.literal('remind'), runOn, note: z.string().trim().max(500).nullable().optional().transform(n => n || null) }),
])

/** Schedules a one-shot action on the card (run by the hourly cards:automations task). */
export default defineUserHandler(async (event, tx, userId): Promise<ScheduledCardAction> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  // The insert policy limits it to editors and normal cards; the composite FK a column of another board.
  const [row] = await tx.insert(schema.cardScheduledActions)
    .values({ ...input, boardId, cardId: id, createdBy: userId })
    .returning(scheduledActionFields)
  return toScheduledAction(row!)
})
