import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { columnOutlineSchema } from '#shared/columnOutline'

const body = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  color: hexColor.nullable().optional(),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  outline: columnOutlineSchema.nullable().optional(),
  // Reorder: neighbours after the move (null = start / end).
  aboveId: z.uuid().nullable().optional(),
  belowId: z.uuid().nullable().optional(),
})

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { columns } = schema

  const [col] = await tx.select({ boardId: columns.boardId }).from(columns).where(eq(columns.id, id))
  if (!col) notFound('Column not found')

  const patch: Partial<typeof columns.$inferInsert> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.color !== undefined) patch.color = input.color
  if (input.wipLimit !== undefined) patch.wipLimit = input.wipLimit
  if (input.outline !== undefined) patch.outline = input.outline
  if (input.aboveId !== undefined || input.belowId !== undefined) {
    patch.position = await positionBetween(tx, 'column', col.boardId, input.aboveId ?? null, input.belowId ?? null)
  }
  if (!Object.keys(patch).length) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const [row] = await tx.update(columns).set(patch).where(eq(columns.id, id))
    .returning({ id: columns.id, title: columns.title, position: columns.position, color: columns.color, wipLimit: columns.wipLimit, outline: columns.outline })
  if (!row) throw createError({ statusCode: 403, statusMessage: 'You do not have permission to do that' })
  return row
})
