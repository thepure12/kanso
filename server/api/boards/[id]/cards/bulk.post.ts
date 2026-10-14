import { and, eq, inArray, not, sql } from 'drizzle-orm'
import { z } from 'zod'
import { priorities, type Card } from '#shared/types/board'

const ids = z.array(z.uuid()).max(50).transform(ids => [...new Set(ids)])

const body = z.object({
  cardIds: z.array(z.uuid()).min(1).max(200).transform(ids => [...new Set(ids)]),
  // End of this column, keeping the cards' board order.
  columnId: z.uuid().optional(),
  archived: z.boolean().optional(),
  priority: z.enum(priorities).nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  addTagIds: ids.optional(),
  removeTagIds: ids.optional(),
  addAssigneeIds: ids.optional(),
  removeAssigneeIds: ids.optional(),
}).refine(({ cardIds: _, ...action }) => Object.values(action).some(v => v !== undefined && !(Array.isArray(v) && !v.length)), {
  message: 'Nothing to change',
})

/**
 * Applies one change to several cards of the board in one transaction: all of
 * them change or none (404 when any card is missing, a template or not editable).
 * Returns the changed cards that are not archived.
 */
export default defineUserHandler(async (event, tx): Promise<{ cards: Card[] }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardIds, columnId, archived, priority, dueDate, addTagIds, removeTagIds, addAssigneeIds, removeAssigneeIds } = await readValidated(event, body)
  const { cards, cardTags, cardAssignees } = schema
  const ofBoard = and(eq(cards.boardId, id), inArray(cards.id, cardIds), not(cards.isTemplate))

  // Touches every row first, so edit rights (RLS) are proven for all of them.
  const rows = await tx.update(cards).set({ updatedAt: sql`now()` }).where(ofBoard).returning({ id: cards.id })
  if (rows.length !== cardIds.length) notFound('Card not found or not allowed')

  if (columnId) {
    // One by one, so each card's column rules run (triggers). The composite FK
    // rejects a column of another board.
    const moving = await tx.execute<{ id: string }>(sql`
      select c.id from cards c join columns col on col.id = c.column_id
      where c.id in ${cardIds} and c.column_id <> ${columnId}
      order by col.position, c.position
    `)
    let position = await endPosition(tx, 'card', columnId)
    for (const { id: cardId } of moving) {
      await tx.update(cards).set({ columnId, position }).where(eq(cards.id, cardId))
      position += 1024
    }
  }

  // After the move, so explicit values win over the column's rules.
  const patch = {
    ...(priority !== undefined && { priority }),
    ...(dueDate !== undefined && { dueDate }),
    ...(archived !== undefined && { archivedAt: archived ? sql`coalesce(${cards.archivedAt}, now())` : null }),
  }
  if (Object.keys(patch).length) await tx.update(cards).set(patch).where(ofBoard)

  // Composite FKs reject tags from another board; the insert policy rejects non-members.
  if (removeTagIds?.length) await tx.delete(cardTags).where(and(inArray(cardTags.cardId, cardIds), inArray(cardTags.tagId, removeTagIds)))
  if (addTagIds?.length) {
    await tx.insert(cardTags).values(cardIds.flatMap(cardId => addTagIds.map(tagId => ({ cardId, tagId, boardId: id })))).onConflictDoNothing()
  }
  if (removeAssigneeIds?.length) {
    await tx.delete(cardAssignees).where(and(inArray(cardAssignees.cardId, cardIds), inArray(cardAssignees.userId, removeAssigneeIds)))
  }
  if (addAssigneeIds?.length) {
    await tx.insert(cardAssignees).values(cardIds.flatMap(cardId => addAssigneeIds.map(userId => ({ cardId, userId, boardId: id })))).onConflictDoNothing()
  }

  return { cards: await loadCards(tx, sql`c.id in ${cardIds} and c.archived_at is null`) }
})
