import { and, eq, notInArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { priorities, type Card } from '#shared/types/board'

// Story points; the column is numeric(6, 2).
const estimate = z.number().min(0).max(9999)
const ids = z.array(z.uuid()).max(50).transform(ids => [...new Set(ids)])

const body = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  startDate: z.iso.date().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
  priority: z.enum(priorities).nullable().optional(),
  estimate: estimate.nullable().optional(),
  // An image attachment of this card (checked by trigger), or null.
  coverAttachmentId: z.uuid().nullable().optional(),
  archived: z.boolean().optional(),
  // Replace the card's whole tag / assignee set.
  tagIds: ids.optional(),
  assigneeIds: ids.optional(),
})

export default defineUserHandler(async (event, tx): Promise<Card> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { tagIds, assigneeIds, archived, ...patch } = await readValidated(event, body)
  const { cards, cardTags, cardAssignees } = schema
  // Always touches the row, so a tag-only change still proves edit rights (RLS) and bumps updated_at.
  const [row] = await tx.update(cards).set({
    ...patch,
    ...(archived !== undefined && { archivedAt: archived ? sql`coalesce(${cards.archivedAt}, now())` : null }),
    updatedAt: sql`now()`,
  }).where(eq(cards.id, id)).returning({ boardId: cards.boardId })
  if (!row) notFound('Card not found or not allowed')

  // Only the differences are written, so the activity log shows real changes.
  // Composite FKs reject tags from another board; the insert policy rejects non-members.
  if (tagIds) {
    await tx.delete(cardTags).where(and(eq(cardTags.cardId, id), tagIds.length ? notInArray(cardTags.tagId, tagIds) : undefined))
    if (tagIds.length) await tx.insert(cardTags).values(tagIds.map(tagId => ({ cardId: id, tagId, boardId: row.boardId }))).onConflictDoNothing()
  }
  if (assigneeIds) {
    await tx.delete(cardAssignees).where(and(eq(cardAssignees.cardId, id), assigneeIds.length ? notInArray(cardAssignees.userId, assigneeIds) : undefined))
    if (assigneeIds.length) await tx.insert(cardAssignees).values(assigneeIds.map(userId => ({ cardId: id, userId, boardId: row.boardId }))).onConflictDoNothing()
  }

  const [card] = await loadCards(tx, sql`c.id = ${id}`)
  return card!
})
