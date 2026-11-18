import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { SnoozedCard } from '#shared/types/board'

/** The board's snoozed cards (not archived, not templates), the next to wake first. */
export default defineUserHandler(async (event, tx): Promise<SnoozedCard[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cards } = schema
  const rows = await tx.select({ id: cards.id, columnId: cards.columnId, title: cards.title, snoozedUntil: cards.snoozedUntil })
    .from(cards)
    .where(and(eq(cards.boardId, id), isNotNull(cards.snoozedUntil), isNull(cards.archivedAt), eq(cards.isTemplate, false)))
    .orderBy(asc(cards.snoozedUntil), asc(cards.title))
  return rows.map(r => ({ ...r, snoozedUntil: r.snoozedUntil! }))
})
