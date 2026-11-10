import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ColumnGroup } from '#shared/types/board'

export const columnGroupName = z.string().trim().min(1).max(50)
export const columnGroupColumnIds = z.array(z.uuid()).max(200).transform(ids => [...new Set(ids)])

/** A board's column groups in position order, members in column order. */
export async function loadColumnGroups(tx: Tx, boardId: string): Promise<ColumnGroup[]> {
  const { columnGroups: g } = schema
  const rows = await tx.select({
    id: g.id, name: g.name, color: g.color, position: g.position,
    columnIds: sql<string[]>`coalesce((
      select array_agg(m.column_id order by c.position)
      from column_group_members m join columns c on c.id = m.column_id
      where m.group_id = column_groups.id
    ), '{}')`,
  }).from(g).where(eq(g.boardId, boardId)).orderBy(asc(g.position))
  return rows
}

/** One group, or null when it is gone or not visible. */
export async function loadColumnGroup(tx: Tx, id: string): Promise<ColumnGroup | null> {
  const [row] = await tx.select({ boardId: schema.columnGroups.boardId }).from(schema.columnGroups).where(eq(schema.columnGroups.id, id))
  if (!row) return null
  return (await loadColumnGroups(tx, row.boardId)).find(g => g.id === id) ?? null
}

/** Makes columnIds the group's members: inserts the missing ones, deletes the rest. */
export async function setColumnGroupMembers(tx: Tx, groupId: string, boardId: string, columnIds: string[]) {
  const m = schema.columnGroupMembers
  const current = await tx.select({ columnId: m.columnId }).from(m).where(eq(m.groupId, groupId))
  const have = new Set(current.map(r => r.columnId))
  const want = new Set(columnIds)
  const removed = [...have].filter(id => !want.has(id))
  const added = columnIds.filter(id => !have.has(id))
  if (removed.length) await tx.delete(m).where(and(eq(m.groupId, groupId), inArray(m.columnId, removed)))
  if (added.length) await tx.insert(m).values(added.map(columnId => ({ groupId, columnId, boardId })))
}
