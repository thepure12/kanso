import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { cardLinkKinds, type CardLink } from '#shared/types/board'

const body = z.object({ toCardId: z.uuid(), kind: z.enum(cardLinkKinds) })

/**
 * Links this card to another card of the same board. Same board, no self
 * links, no duplicates and no blocking cycles are enforced in SQL.
 */
export default defineUserHandler(async (event, tx, userId): Promise<CardLink> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { toCardId, kind } = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { cardLinks } = schema
  const [row] = await tx.insert(cardLinks).values({ boardId, fromCardId: id, toCardId, kind, createdBy: userId })
    .returning({ id: cardLinks.id })
  const [link] = await loadCardLinks(tx, sql`l.id = ${row!.id} and l.direction = 'out'`)
  return link!
})
