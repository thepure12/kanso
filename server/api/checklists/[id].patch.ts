import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Checklist } from '#shared/types/board'

const body = z.object({
  name: checklistName.optional(),
  // Reorder among the card's checklists: neighbours after the move (null = start / end).
  aboveId: z.uuid().nullable().optional(),
  belowId: z.uuid().nullable().optional(),
})

/** Renames or moves a checklist; returns it without items. */
export default defineUserHandler(async (event, tx): Promise<Omit<Checklist, 'items'>> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { checklists: cl } = schema

  const [list] = await tx.select({ cardId: cl.cardId }).from(cl).where(eq(cl.id, id))
  if (!list) notFound('Checklist not found')

  const patch: Partial<typeof cl.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.aboveId !== undefined || input.belowId !== undefined) {
    patch.position = await positionBetween(tx, 'checklist', list.cardId, input.aboveId ?? null, input.belowId ?? null)
  }
  if (!Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const [row] = await tx.update(cl).set(patch).where(eq(cl.id, id)).returning(checklistColumns())
  return row ?? notFound('Checklist not found or not allowed')
})
