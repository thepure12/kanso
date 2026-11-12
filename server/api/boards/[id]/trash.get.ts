import { sql } from 'drizzle-orm'
import type { TrashedCard } from '#shared/types/board'

/** The board's trash, newest first. Editors only (app.trashed_cards, 403 otherwise). */
export default defineUserHandler(async (event, tx): Promise<TrashedCard[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  const rows = await tx.execute<{ id: string, title: string, column_id: string, is_template: boolean, deleted_at: Date | string, deleted_by_name: string | null }>(
    sql`select * from app.trashed_cards(${id})`)
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    columnId: r.column_id,
    isTemplate: r.is_template,
    deletedAt: new Date(r.deleted_at).toISOString(),
    deletedBy: r.deleted_by_name,
  }))
})
