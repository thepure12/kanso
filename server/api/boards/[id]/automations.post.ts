import { z } from 'zod'
import { priorities, type BoardAutomation } from '#shared/types/board'

const staleDays = z.number().int().min(1).max(365)
const columnId = z.uuid().nullable().optional()
const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('archive_done'), days: staleDays, columnId }),
  z.object({ kind: z.literal('tag_stale'), days: staleDays, tagId: z.uuid(), columnId }),
  z.object({ kind: z.literal('notify_stale'), days: staleDays, columnId }),
  z.object({ kind: z.literal('raise_priority'), days: z.number().int().min(0).max(365), priority: z.enum(priorities), columnId }),
  // The check constraint refuses targetColumnId = columnId (400).
  z.object({ kind: z.literal('move_card'), days: staleDays, columnId: z.uuid(), targetColumnId: z.uuid() }),
])

/** Adds a time-based automation (run hourly by the cards:automations task). */
export default defineUserHandler(async (event, tx): Promise<BoardAutomation> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  // The insert policy rejects viewers; the composite FKs a tag or column of another board;
  // the unique constraint the same automation twice (409).
  const [row] = await tx.insert(schema.boardAutomations).values({ boardId: id, ...input }).returning(boardAutomationFields)
  return toBoardAutomation(row!)
})
