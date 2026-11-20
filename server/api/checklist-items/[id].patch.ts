import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ChecklistItem } from '#shared/types/board'

const body = z.object({
  text: checklistItemText.optional(),
  done: z.boolean().optional(),
  ...checklistItemExtras,
  // Move into another checklist of the same card (at the end unless neighbours are given).
  checklistId: z.uuid().optional(),
  // Reorder: neighbours in the (new) checklist after the move (null = start / end).
  aboveId: z.uuid().nullable().optional(),
  belowId: z.uuid().nullable().optional(),
})

export default defineUserHandler(async (event, tx): Promise<ChecklistItem> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { checklistItems: ci, checklists: cl } = schema

  const [item] = await tx.select({ cardId: ci.cardId, checklistId: ci.checklistId }).from(ci).where(eq(ci.id, id))
  if (!item) notFound('Checklist item not found')

  const patch: Partial<typeof ci.$inferInsert> = {}
  if (input.text !== undefined) patch.text = input.text
  if (input.done !== undefined) patch.done = input.done
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate
  const moved = input.checklistId !== undefined && input.checklistId !== item.checklistId
  if (moved) {
    const [list] = await tx.select({ id: cl.id }).from(cl).where(and(eq(cl.id, input.checklistId!), eq(cl.cardId, item.cardId)))
    if (!list) notFound('Checklist not found')
    patch.checklistId = list.id
  }
  const listId = patch.checklistId ?? item.checklistId
  if (moved || input.aboveId !== undefined || input.belowId !== undefined) {
    patch.position = await positionBetween(tx, 'checklistItem', listId, input.aboveId ?? null, input.belowId ?? null)
  }
  if (!Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const [row] = await tx.update(ci).set(patch).where(eq(ci.id, id)).returning(checklistItemColumns())
  return row ?? notFound('Checklist item not found or not allowed')
})
