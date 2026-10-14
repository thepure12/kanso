import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Card } from '#shared/types/board'

const body = z.object({
  columnId: z.uuid(),
  // Neighbours in the target column after the move (null = start / end).
  aboveId: z.uuid().nullable(),
  belowId: z.uuid().nullable(),
})

export default defineUserHandler(async (event, tx): Promise<Card> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { columnId, aboveId, belowId } = await readValidated(event, body)
  const { cards } = schema
  const position = await positionBetween(tx, 'card', columnId, aboveId, belowId)
  // Composite FK (column_id, board_id) rejects moves into another board's column.
  const [row] = await tx.update(cards).set({ columnId, position }).where(eq(cards.id, id)).returning({ id: cards.id })
  if (!row) notFound('Card not found or not allowed')
  // Entering a new column may change tags, assignees and due date through its rules (triggers).
  return loadCard(tx, id)
})
