import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ColumnGroup } from '#shared/types/board'

const body = z.object({
  name: columnGroupName.optional(),
  color: hexColor.nullable().optional(),
  // Replaces the member set (only the differences are written).
  columnIds: columnGroupColumnIds.optional(),
  // Reorder: neighbours after the move (null = start / end).
  aboveId: z.uuid().nullable().optional(),
  belowId: z.uuid().nullable().optional(),
})

export default defineUserHandler(async (event, tx): Promise<ColumnGroup> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { columnGroups: g } = schema

  const [group] = await tx.select({ boardId: g.boardId }).from(g).where(eq(g.id, id))
  if (!group) notFound('Column group not found')

  const patch: Partial<typeof g.$inferInsert> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.color !== undefined) patch.color = input.color
  if (input.aboveId !== undefined || input.belowId !== undefined) {
    patch.position = await positionBetween(tx, 'columnGroup', group.boardId, input.aboveId ?? null, input.belowId ?? null)
  }
  if (!Object.keys(patch).length && !input.columnIds) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  if (Object.keys(patch).length) {
    const rows = await tx.update(g).set(patch).where(eq(g.id, id)).returning({ id: g.id })
    if (!rows.length) notFound('Column group not found or not allowed')
  }
  if (input.columnIds) await setColumnGroupMembers(tx, id, group.boardId, input.columnIds)
  return (await loadColumnGroup(tx, id)) ?? notFound('Column group not found')
})
