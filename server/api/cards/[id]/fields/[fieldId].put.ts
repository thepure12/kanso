import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isValidFieldValue } from '#shared/fields'
import type { FieldOption, FieldValue } from '#shared/types/board'

const params = z.object({ id: z.uuid(), fieldId: z.uuid() })
const body = z.object({ value: z.union([z.string(), z.number(), z.boolean()]).nullable() })

/** Sets a card's value for a field, or clears it with null. */
export default defineUserHandler(async (event, tx): Promise<{ value: FieldValue | null }> => {
  const { id, fieldId } = await paramsValidated(event, params)
  const { value } = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { boardFields: f, cardFieldValues: v } = schema

  const [field] = await tx.select({ kind: f.kind, options: f.options }).from(f)
    .where(and(eq(f.id, fieldId), eq(f.boardId, boardId)))
  if (!field) notFound('Field not found')

  if (value === null) {
    const match = and(eq(v.cardId, id), eq(v.fieldId, fieldId))
    const deleted = await tx.delete(v).where(match).returning({ cardId: v.cardId })
    // RLS filters a viewer's delete to zero rows: a value they can still see was not theirs to clear.
    if (!deleted.length && (await tx.select({ cardId: v.cardId }).from(v).where(match)).length) {
      throw createError({ statusCode: 403, statusMessage: 'You do not have permission to do that' })
    }
    return { value: null }
  }
  if (!isValidFieldValue({ kind: field.kind, options: field.options as FieldOption[] }, value)) {
    throw createError({ statusCode: 400, statusMessage: 'That value does not fit the field' })
  }
  await tx.insert(v).values({ cardId: id, boardId, fieldId, value })
    .onConflictDoUpdate({ target: [v.cardId, v.fieldId], set: { value, updatedAt: sql`now()` } })
  return { value }
})
