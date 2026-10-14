import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ChecklistItem } from '#shared/types/board'

const body = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  done: z.boolean().optional(),
  // Reorder: neighbours after the move (null = start / end).
  aboveId: z.uuid().nullable().optional(),
  belowId: z.uuid().nullable().optional(),
})

export default defineUserHandler(async (event, tx): Promise<ChecklistItem> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { checklistItems: ci } = schema

  const [item] = await tx.select({ cardId: ci.cardId }).from(ci).where(eq(ci.id, id))
  if (!item) notFound('Checklist item not found')

  const patch: Partial<typeof ci.$inferInsert> = {}
  if (input.text !== undefined) patch.text = input.text
  if (input.done !== undefined) patch.done = input.done
  if (input.aboveId !== undefined || input.belowId !== undefined) {
    patch.position = await positionBetween(tx, 'checklist', item.cardId, input.aboveId ?? null, input.belowId ?? null)
  }
  if (!Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const [row] = await tx.update(ci).set(patch).where(eq(ci.id, id))
    .returning({ id: ci.id, text: ci.text, done: ci.done, position: ci.position })
  return row ?? notFound('Checklist item not found or not allowed')
})
