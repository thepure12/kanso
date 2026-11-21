import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { cardLinkKinds, type CardLink } from '#shared/types/board'

const body = z.object({ toCardId: z.uuid(), kind: z.enum(cardLinkKinds), direction: z.enum(['out', 'in']).default('out') })

/**
 * Links this card to another card of the same board. Same board, no self
 * links, no duplicates and no blocking cycles are enforced in SQL.
 * `direction: 'in'` stores the link the other way round ("blocked by",
 * "duplicated by"); the response is the link as seen from this card.
 */
export default defineUserHandler(async (event, tx, userId): Promise<CardLink> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { toCardId, kind, direction } = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { cardLinks } = schema
  const [fromCardId, to] = direction === 'out' ? [id, toCardId] : [toCardId, id]
  const [row] = await tx.insert(cardLinks).values({ boardId, fromCardId, toCardId: to, kind, createdBy: userId })
    .returning({ id: cardLinks.id })
  const [link] = await loadCardLinks(tx, sql`l.id = ${row!.id} and l.direction = ${direction}`)
  return link!
})
