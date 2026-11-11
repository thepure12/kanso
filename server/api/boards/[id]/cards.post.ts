import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Card } from '#shared/types/board'
import { CARD_TITLE_MAX } from '#shared/cards'

const body = z.object({
  columnId: z.uuid(),
  title: z.string().trim().min(1).max(CARD_TITLE_MAX).optional(),
  description: z.string().max(10_000).default(''),
  // Copy this template (title, description, tags, assignees, checklist, fields...); title overrides its title.
  templateId: z.uuid().optional(),
}).refine(b => b.title !== undefined || b.templateId !== undefined, { message: 'A title or a template is required' })

export default defineUserHandler(async (event, tx, userId): Promise<Card> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { columnId, title, description, templateId } = await readValidated(event, body)
  const { cards } = schema
  let cardId: string
  if (templateId) {
    if (await cardBoardId(tx, templateId) !== id) notFound('Template not found')
    const [row] = await tx.execute<{ id: string }>(sql`select app.copy_card(${templateId}, ${columnId}, false, true, null, ${title ?? null}) as id`)
    cardId = row!.id
  }
  else {
    const [card] = await tx.insert(cards)
      .values({ boardId: id, columnId, title: title!, description, createdBy: userId, position: await endPosition(tx, 'card', columnId) })
      .returning({ id: cards.id })
    cardId = card!.id
  }
  // Tags, assignees and due date may come from the column's rules (triggers).
  return loadCard(tx, cardId)
})
