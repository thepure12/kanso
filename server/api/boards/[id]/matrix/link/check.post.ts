import { and, eq, sql } from 'drizzle-orm'
import type { MatrixUserLink } from '#shared/types/matrix'
import type { MatrixEvent } from '../../../../../utils/matrix'

/**
 * Finishes linking the caller's Matrix account: the board's bot looks for the
 * pending code among that account's latest messages in the board's room, then
 * app.confirm_matrix_user marks the link verified and the bot redacts the code
 * message (when it may). 400 while the code is not in the room yet.
 */
export default defineUserHandler(async (event, tx, userId): Promise<MatrixUserLink> => {
  const { id } = await paramsValidated(event, uuidParam)
  const u = schema.boardMatrixUsers
  const [row] = await tx.select({ mxid: u.mxid, code: u.code, codeExpiresAt: u.codeExpiresAt, createdAt: u.createdAt })
    .from(u).where(and(eq(u.boardId, id), eq(u.userId, userId)))
  if (!row) notFound('No Matrix account to link')
  if (!row.code) return (await loadMyMatrixLink(tx, id, userId))!
  if (!row.codeExpiresAt || row.codeExpiresAt < new Date()) throw createError({ statusCode: 400, statusMessage: 'The code has expired. Start linking again.' })
  await rateLimit(`matrix-link-check:${userId}`, 30, 15 * 60_000)
  const bot = await boardMatrixBot(tx, id)
  let found: MatrixEvent | null
  try {
    found = await findLinkCode(bot, bot.roomId, row.mxid, row.code, row.createdAt)
  }
  catch (e) {
    matrixHttpError(e)
  }
  if (!found) throw createError({ statusCode: 400, statusMessage: `The code was not found in the room. Send "${matrixLinkMessage(row.code)}" from ${row.mxid}, then check again.` })
  const [confirmed] = await tx.execute<{ ok: boolean }>(sql`select app.confirm_matrix_user(${id}, ${row.code}) as ok`)
  if (!confirmed?.ok) throw createError({ statusCode: 400, statusMessage: 'The code has expired. Start linking again.' })
  await redactEvent(bot, bot.roomId, found.event_id, 'Kanso link code')
  return (await loadMyMatrixLink(tx, id, userId))!
})
