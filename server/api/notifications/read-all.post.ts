import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({ boardId: z.uuid().optional() })

/** Marks the caller's unread notifications read, all of them or one board's (`?boardId=`). */
export default defineUserHandler(async (event, tx) => {
  const { boardId } = await getValidatedQuery(event, v => query.parse(v))
  const { notifications: n } = schema
  const rows = await tx.update(n).set({ readAt: new Date() })
    .where(and(isNull(n.readAt), boardId ? eq(n.boardId, boardId) : undefined)).returning({ id: n.id })
  return { updated: rows.length }
})
