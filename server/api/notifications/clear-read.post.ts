import { and, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({ boardId: z.uuid().optional() })

/** Deletes the caller's read notifications, all of them or one board's (`?boardId=`). */
export default defineUserHandler(async (event, tx) => {
  const { boardId } = await getValidatedQuery(event, v => query.parse(v))
  const { notifications: n } = schema
  const rows = await tx.delete(n)
    .where(and(isNotNull(n.readAt), boardId ? eq(n.boardId, boardId) : undefined)).returning({ id: n.id })
  return { deleted: rows.length }
})
