import { z } from 'zod'
import { reactionEmojis } from '#shared/reactions'

const body = z.object({ emoji: z.enum(reactionEmojis) })

/** Adds the current user's reaction. Idempotent. Returns the comment's reactions. */
export default defineUserHandler(async (event, tx, userId) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { emoji } = await readValidated(event, body)
  const boardId = await commentBoardId(tx, id)
  // RLS: anyone with access to the unarchived board, for themselves only.
  await tx.insert(schema.commentReactions).values({ commentId: id, boardId, userId, emoji }).onConflictDoNothing()
  return (await loadReactions(tx, [id], userId)).get(id) ?? []
})
