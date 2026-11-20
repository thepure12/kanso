import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AssigneeGroup } from '#shared/types/board'

export const assigneeGroupName = z.string().trim().min(1).max(50)
export const assigneeGroupUserIds = z.array(z.uuid()).max(200).transform(ids => [...new Set(ids)])

/**
 * A board's assignee groups by name. Members are the people who still have
 * access to the board, by name (rows of people who left stay but are hidden).
 */
export async function loadAssigneeGroups(tx: Tx, boardId: string): Promise<AssigneeGroup[]> {
  const { assigneeGroups: g } = schema
  return tx.select({
    id: g.id, name: g.name,
    userIds: sql<string[]>`coalesce((
      select array_agg(m.user_id order by u.name, u.id)
      from assignee_group_members m join users u on u.id = m.user_id
      where m.group_id = assignee_groups.id and app.is_member(m.board_id, m.user_id)
    ), '{}')`,
  }).from(g).where(eq(g.boardId, boardId)).orderBy(sql`lower(${g.name})`, asc(g.id))
}

/** One group, or null when it is gone or not visible. */
export async function loadAssigneeGroup(tx: Tx, id: string): Promise<AssigneeGroup | null> {
  const [row] = await tx.select({ boardId: schema.assigneeGroups.boardId }).from(schema.assigneeGroups).where(eq(schema.assigneeGroups.id, id))
  if (!row) return null
  return (await loadAssigneeGroups(tx, row.boardId)).find(g => g.id === id) ?? null
}

/** Makes userIds the group's members: inserts the missing ones, deletes the rest. */
export async function setAssigneeGroupMembers(tx: Tx, groupId: string, boardId: string, userIds: string[]) {
  const m = schema.assigneeGroupMembers
  const current = await tx.select({ userId: m.userId }).from(m).where(eq(m.groupId, groupId))
  const have = new Set(current.map(r => r.userId))
  const want = new Set(userIds)
  const removed = [...have].filter(id => !want.has(id))
  const added = userIds.filter(id => !have.has(id))
  if (removed.length) await tx.delete(m).where(and(eq(m.groupId, groupId), inArray(m.userId, removed)))
  if (added.length) await tx.insert(m).values(added.map(userId => ({ groupId, boardId, userId })))
}
