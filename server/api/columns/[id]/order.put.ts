import { and, eq, isNull, not, sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  // Every card shown in the column (not archived, not a template), in the new order.
  cardIds: z.array(z.uuid()).max(5000),
})

/** Reorders a column's cards in one go (sort by priority and its undo). Column rules do not run. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardIds } = await readValidated(event, body)
  const { cards, columns } = schema

  const [col] = await tx.select({ id: columns.id }).from(columns).where(eq(columns.id, id))
  if (!col) notFound('Column not found')

  const current = await tx.select({ id: cards.id }).from(cards)
    .where(and(eq(cards.columnId, id), isNull(cards.archivedAt), not(cards.isTemplate)))
  const known = new Set(current.map(c => c.id))
  if (new Set(cardIds).size !== cardIds.length || cardIds.length !== known.size || cardIds.some(c => !known.has(c))) {
    throw createError({ statusCode: 409, statusMessage: 'The column has changed, reload and try again' })
  }
  if (!cardIds.length) return { cardIds }

  const rows = await tx.execute<{ id: string }>(sql`
    update cards c set position = o.ord * 1024
    from unnest(${`{${cardIds.join(',')}}`}::uuid[]) with ordinality as o(id, ord)
    where c.id = o.id and c.column_id = ${id}
    returning c.id`)
  if (rows.length !== cardIds.length) throw createError({ statusCode: 403, statusMessage: 'You do not have permission to do that' })
  return { cardIds }
})
