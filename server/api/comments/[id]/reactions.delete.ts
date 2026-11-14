import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { reactionEmojis } from '#shared/reactions'

const body = z.object({ emoji: z.enum(reactionEmojis) })

/** Removes the current user's reaction. Idempotent. Returns the comment's reactions. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { emoji } = await readValidated(event, body)
  await commentBoardId(tx, id)
  const { commentReactions: r } = schema
  const mine = and(eq(r.commentId, id), eq(r.userId, userId), eq(r.emoji, emoji))
  // RLS: only one's own rows, and none while the board is archived.
  const rows = await tx.delete(r).where(mine).returning({ id: r.commentId })
  if (!rows.length && await tx.$count(r, mine)) throw createError({ statusCode: 403, statusMessage: 'Board is archived' })
  return (await loadReactions(tx, [id], userId)).get(id) ?? []
})
