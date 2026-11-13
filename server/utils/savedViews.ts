import { asc, eq, sql } from 'drizzle-orm'
import type { SavedView } from '#shared/types/board'

const { savedViews: v } = schema

const savedViewFields = { id: v.id, name: v.name, shared: sql<boolean>`${v.userId} is null`, config: v.config }

/** Shared views and the user's own (RLS hides other people's), by name. */
export function loadSavedViews(tx: Tx, boardId: string): Promise<SavedView[]> {
  return tx.select(savedViewFields).from(v).where(eq(v.boardId, boardId))
    .orderBy(asc(sql`lower(${v.name})`), asc(v.createdAt))
}

/** One view, or null when it is gone or not visible. */
export async function loadSavedView(tx: Tx, id: string): Promise<SavedView | null> {
  const [row] = await tx.select(savedViewFields).from(v).where(eq(v.id, id))
  return row ?? null
}
