import { asc, eq, inArray } from 'drizzle-orm'
import type { CommentReaction } from '#shared/types/board'

/** Reactions of the given comments, grouped by emoji in the order first used. */
export async function loadReactions(tx: Tx, commentIds: string[], userId: string) {
  const out = new Map<string, CommentReaction[]>()
  if (!commentIds.length) return out
  const { commentReactions: r, users } = schema
  // users rows are visible only while the person shares a board or team with the caller.
  const rows = await tx.select({ commentId: r.commentId, emoji: r.emoji, userId: r.userId, name: users.name })
    .from(r).leftJoin(users, eq(users.id, r.userId))
    .where(inArray(r.commentId, commentIds)).orderBy(asc(r.createdAt), asc(r.userId))
  for (const row of rows) {
    const list = out.get(row.commentId) ?? []
    let group = list.find(g => g.emoji === row.emoji)
    if (!group) list.push(group = { emoji: row.emoji, count: 0, mine: false, names: [] })
    group.count++
    if (row.userId === userId) group.mine = true
    if (row.name !== null) group.names.push(row.name)
    out.set(row.commentId, list)
  }
  return out
}

/** The comment's board id, or 404 when the caller cannot see it. */
export async function commentBoardId(tx: Tx, id: string): Promise<string> {
  const { cardComments: cc } = schema
  const [row] = await tx.select({ boardId: cc.boardId }).from(cc).where(eq(cc.id, id))
  return row?.boardId ?? notFound('Comment not found')
}
