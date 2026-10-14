import { and, eq } from 'drizzle-orm'

/** Unstars the board. Idempotent. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  const { boardStars: s } = schema
  await tx.delete(s).where(and(eq(s.boardId, id), eq(s.userId, userId)))
  return { starred: false }
})
