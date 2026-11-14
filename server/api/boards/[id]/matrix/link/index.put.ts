import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { MatrixUserLink } from '#shared/types/matrix'

const body = z.object({
  mxid: z.string().trim().max(255).regex(/^@[^:\s]+:\S+$/, 'Enter a Matrix ID like @you:example.org'),
})

/**
 * Starts linking the caller's Matrix account on the board (replacing any
 * earlier link): board_matrix_users_insert lets anyone on a board with a
 * Matrix room add their own row, and the database picks the code. Nothing is
 * sent to Matrix; the user posts the code in the room, then calls check.
 */
export default defineUserHandler(async (event, tx, userId): Promise<MatrixUserLink> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { mxid } = await readValidated(event, body)
  await rateLimit(`matrix-link:${userId}`, 20, 15 * 60_000)
  const u = schema.boardMatrixUsers
  await tx.delete(u).where(and(eq(u.boardId, id), eq(u.userId, userId)))
  // Plain SQL: Drizzle would list every column, and kanban_app may insert only these three.
  await tx.execute(sql`insert into board_matrix_users (board_id, user_id, mxid) values (${id}, ${userId}, ${mxid})`)
  return (await loadMyMatrixLink(tx, id, userId))!
})
