import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { boardNotificationLevels } from '#shared/notificationSettings'

const body = z.object({ level: z.enum(boardNotificationLevels) })

/** Sets the current user's notification level for the board (personal row; all = no row). */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { level } = await readValidated(event, body)
  await assertBoardVisible(tx, id)
  const t = schema.boardNotificationSettings
  if (level === 'all') {
    await tx.delete(t).where(and(eq(t.boardId, id), eq(t.userId, userId)))
  }
  else {
    // RLS: only for themselves, on boards they can see.
    await tx.insert(t).values({ userId, boardId: id, level })
      .onConflictDoUpdate({ target: [t.userId, t.boardId], set: { level } })
  }
  return { level }
})
