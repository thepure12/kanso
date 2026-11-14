import { and, eq } from 'drizzle-orm'

/** Unlinks the caller's Matrix account on the board (board_matrix_users_delete: their own row). Nothing is sent to Matrix. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const u = schema.boardMatrixUsers
  const rows = await tx.delete(u).where(and(eq(u.boardId, id), eq(u.userId, userId))).returning({ mxid: u.mxid })
  if (!rows.length) notFound('No Matrix account linked')
  return { ok: true }
})
