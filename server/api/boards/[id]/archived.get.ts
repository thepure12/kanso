import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { ArchivedCard } from '#shared/types/board'

export default defineUserHandler(async (event, tx): Promise<ArchivedCard[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cards } = schema
  const rows = await tx.select({ id: cards.id, columnId: cards.columnId, title: cards.title, archivedAt: cards.archivedAt })
    .from(cards).where(and(eq(cards.boardId, id), isNotNull(cards.archivedAt), eq(cards.isTemplate, false))).orderBy(desc(cards.archivedAt))
  return rows.map(r => ({ ...r, archivedAt: r.archivedAt!.toISOString() }))
})
