import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardMatrixRoom } from '#shared/types/matrix'

const body = z.object({
  postActivity: z.boolean().optional(),
  activityEvents: webhookEventsSchema.optional(),
})

/** Changes what the bot posts into card threads (board_matrix_rooms_update: owners). */
export default defineUserHandler(async (event, tx): Promise<BoardMatrixRoom> => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  const m = schema.boardMatrixRooms
  const rows = await tx.update(m).set({ ...patch, updatedAt: sql`now()` }).where(eq(m.boardId, id)).returning({ boardId: m.boardId })
  if (!rows.length) notFound('No Matrix room connected')
  return (await loadMatrixRoom(tx, id))!
})
