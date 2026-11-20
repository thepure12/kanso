import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ChecklistItem } from '#shared/types/board'

const body = z.object({
  text: checklistItemText,
  // Without it the item goes into the card's first checklist (one named "Checklist" is created when it has none).
  checklistId: z.uuid().optional(),
  ...checklistItemExtras,
})

export default defineUserHandler(async (event, tx): Promise<ChecklistItem> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { text, checklistId, assigneeId, dueDate } = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { checklists: cl, checklistItems: ci } = schema

  let listId = checklistId
  if (listId) {
    const [list] = await tx.select({ id: cl.id }).from(cl).where(and(eq(cl.id, listId), eq(cl.cardId, id)))
    if (!list) notFound('Checklist not found')
  }
  else {
    const [first] = await tx.select({ id: cl.id }).from(cl).where(eq(cl.cardId, id)).orderBy(asc(cl.position), asc(cl.createdAt), asc(cl.id)).limit(1)
    listId = first?.id ?? (await tx.insert(cl).values({ cardId: id, boardId, name: 'Checklist', position: 1024 }).returning({ id: cl.id }))[0]!.id
  }

  const [item] = await tx.insert(ci).values({
    cardId: id, boardId, checklistId: listId, text, assigneeId: assigneeId ?? null, dueDate: dueDate ?? null,
    position: await endPosition(tx, 'checklistItem', listId),
  }).returning(checklistItemColumns())
  return item!
})
