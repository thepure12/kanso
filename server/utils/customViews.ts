import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CustomView, CustomViewSummary, ViewColumn } from '#shared/types/customViews'

const { customViews: v, customViewColumns: vc, columns: c, boards: b } = schema

const columnFields = { columnId: c.id, boardId: c.boardId, boardName: b.name, title: c.title, color: c.color }

/**
 * Columns the user may put into a view: every column they can see (the
 * columns policies; limited members only their visible ones) on unarchived
 * boards, by board name and column order.
 */
export function loadViewableColumns(tx: Tx): Promise<ViewColumn[]> {
  return tx.select(columnFields).from(c).innerJoin(b, eq(b.id, c.boardId))
    .where(isNull(b.archivedAt))
    .orderBy(asc(sql`lower(${b.name})`), asc(b.id), asc(c.position))
}

/** The user's views by name, with the number of columns they can still see. */
export function loadCustomViews(tx: Tx): Promise<CustomViewSummary[]> {
  return tx.select({ id: v.id, name: v.name, starred: sql<boolean>`${v.starredAt} is not null`, columnCount: count(c.id), background: v.background, accent: v.accent })
    .from(v)
    .leftJoin(vc, eq(vc.viewId, v.id))
    .leftJoin(c, eq(c.id, vc.columnId))
    .groupBy(v.id)
    .orderBy(asc(sql`lower(${v.name})`), asc(v.createdAt))
}

/** One view of the user's (null when not theirs or gone); columns the user cannot see are left out by RLS. */
export async function loadCustomView(tx: Tx, id: string): Promise<CustomView | null> {
  const [row] = await tx.select({ id: v.id, name: v.name, starred: sql<boolean>`${v.starredAt} is not null`, background: v.background, accent: v.accent, columnOutline: v.columnOutline }).from(v).where(eq(v.id, id))
  if (!row) return null
  const columns = await tx.select(columnFields).from(vc)
    .innerJoin(c, and(eq(c.id, vc.columnId), eq(c.boardId, vc.boardId)))
    .innerJoin(b, eq(b.id, c.boardId))
    .where(eq(vc.viewId, id))
    .orderBy(asc(vc.position))
  return { ...row, columns }
}

/**
 * Replaces the view's columns with these, in this order. Every id must be a
 * column the user can see (400 otherwise); the insert policy checks it again.
 */
export async function setCustomViewColumns(tx: Tx, viewId: string, columnIds: string[]) {
  await tx.delete(vc).where(eq(vc.viewId, viewId))
  if (!columnIds.length) return
  const found = await tx.select({ id: c.id, boardId: c.boardId }).from(c).where(inArray(c.id, columnIds))
  const boardOf = new Map(found.map(r => [r.id, r.boardId]))
  if (boardOf.size !== columnIds.length) throw createError({ statusCode: 400, statusMessage: 'Unknown column' })
  await tx.insert(vc).values(columnIds.map((columnId, position) => ({ viewId, columnId, boardId: boardOf.get(columnId)!, position })))
}

/** Stars or unstars one of the user's views (404 when not theirs); starring again keeps the first time. */
export async function setCustomViewStar(tx: Tx, id: string, starred: boolean) {
  // RLS: only the view's user sees the row.
  const rows = await tx.update(v)
    .set({ starredAt: starred ? sql`coalesce(${v.starredAt}, now())` : null })
    .where(eq(v.id, id))
    .returning({ id: v.id })
  if (!rows.length) notFound('View not found')
}
