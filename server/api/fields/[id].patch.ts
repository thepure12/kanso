import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardField } from '#shared/types/board'

const body = z.object({
  name: fieldName.optional(),
  // Select fields only. Values that used a removed option are cleared (trigger).
  options: fieldOptions.optional(),
  showOnCard: z.boolean().optional(),
  // Reorder: neighbours after the move (null = start / end).
  aboveId: z.uuid().nullable().optional(),
  belowId: z.uuid().nullable().optional(),
})

export default defineUserHandler(async (event, tx): Promise<BoardField> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { boardFields: f } = schema

  const [field] = await tx.select({ boardId: f.boardId }).from(f).where(eq(f.id, id))
  if (!field) notFound('Field not found')

  const patch: Partial<typeof f.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.options !== undefined) patch.options = input.options
  if (input.showOnCard !== undefined) patch.showOnCard = input.showOnCard
  if (input.aboveId !== undefined || input.belowId !== undefined) {
    patch.position = await positionBetween(tx, 'field', field.boardId, input.aboveId ?? null, input.belowId ?? null)
  }
  if (!Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const [row] = await tx.update(f).set(patch).where(eq(f.id, id)).returning(boardFieldColumns)
  return row ? toBoardField(row) : notFound('Field not found or not allowed')
})
