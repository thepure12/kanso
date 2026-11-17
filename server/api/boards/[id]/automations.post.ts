import { z } from 'zod'
import { priorities, type BoardAutomation } from '#shared/types/board'

const staleDays = z.number().int().min(1).max(365)
// A column or a card (or neither: the whole board), not both.
const scope = { columnId: z.uuid().nullable().optional(), cardId: z.uuid().nullable().optional() }
const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('archive_done'), days: staleDays, ...scope }),
  z.object({ kind: z.literal('tag_stale'), days: staleDays, tagId: z.uuid(), ...scope }),
  z.object({ kind: z.literal('notify_stale'), days: staleDays, ...scope }),
  z.object({ kind: z.literal('raise_priority'), days: z.number().int().min(0).max(365), priority: z.enum(priorities), ...scope }),
  // The check constraint refuses targetColumnId = columnId (400).
  z.object({ kind: z.literal('move_card'), days: staleDays, targetColumnId: z.uuid(), ...scope })
    .refine(b => b.columnId || b.cardId, { message: 'Choose a column or a card', path: ['columnId'] }),
]).refine(b => !(b.columnId && b.cardId), { message: 'Choose a column or a card, not both', path: ['cardId'] })

/** Adds a time-based automation (run hourly by the cards:automations task). */
export default defineUserHandler(async (event, tx): Promise<BoardAutomation> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  // The insert policy rejects viewers; the composite FKs a tag, column or card of another board;
  // the unique constraint the same automation twice (409).
  const [row] = await tx.insert(schema.boardAutomations).values({ boardId: id, ...input }).returning(boardAutomationFields)
  return toBoardAutomation(row!)
})
