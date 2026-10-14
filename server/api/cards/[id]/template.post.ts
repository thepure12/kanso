import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Card } from '#shared/types/board'

const body = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  // Keep the card's assignees on the template (and so on cards made from it).
  withAssignees: z.boolean().default(false),
}).default({ withAssignees: false })

/** Saves a copy of the card as a template in the same column (see app.copy_card). */
export default defineUserHandler(async (event, tx): Promise<Card> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { title, withAssignees } = await readValidated(event, body)
  const { cards } = schema
  const [src] = await tx.select({ columnId: cards.columnId }).from(cards).where(eq(cards.id, id))
  if (!src) notFound('Card not found')
  const [row] = await tx.execute<{ id: string }>(sql`select app.copy_card(${id}, ${src.columnId}, true, ${withAssignees}, null, ${title ?? null}) as id`)
  return loadCard(tx, row!.id)
})
