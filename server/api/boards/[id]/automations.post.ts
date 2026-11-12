import { z } from 'zod'
import { priorities, type BoardAutomation } from '#shared/types/board'

const staleDays = z.number().int().min(1).max(365)
const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('archive_done'), days: staleDays }),
  z.object({ kind: z.literal('tag_stale'), days: staleDays, tagId: z.uuid() }),
  z.object({ kind: z.literal('notify_stale'), days: staleDays }),
  z.object({ kind: z.literal('raise_priority'), days: z.number().int().min(0).max(365), priority: z.enum(priorities) }),
])

/** Adds a time-based automation (run hourly by the cards:automations task). */
export default defineUserHandler(async (event, tx): Promise<BoardAutomation> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  // The insert policy rejects viewers; the composite FK a tag of another board;
  // the unique constraint the same automation twice (409).
  const [row] = await tx.insert(schema.boardAutomations).values({ boardId: id, ...input }).returning(boardAutomationFields)
  return toBoardAutomation(row!)
})
