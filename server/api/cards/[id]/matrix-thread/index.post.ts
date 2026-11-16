import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { CardMatrixThread } from '#shared/types/matrix'

const body = z.object({
  /** A message in the board's room (matrix.to / Element link or $event id); omitted: the bot starts a new thread. */
  link: z.string().trim().min(1).max(1000).optional(),
}).default({})

/**
 * Links the card to a Matrix thread in the board's room
 * (card_matrix_threads_insert: editors). The row is written first, so the
 * policy refuses before anything is sent to Matrix; any later failure rolls
 * it back. Without `link` the bot posts the card as a new thread root; with
 * one, the message (or the root of the thread it is in) must be in the
 * board's room.
 */
export default defineUserHandler(async (event, tx, userId): Promise<CardMatrixThread> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { link } = await readValidated(event, body)
  const { cards, boards, cardMatrixThreads: t } = schema
  const [card] = await tx.select({ id: cards.id, title: cards.title, isTemplate: cards.isTemplate, boardId: cards.boardId, boardName: boards.name })
    .from(cards).innerJoin(boards, eq(boards.id, cards.boardId)).where(eq(cards.id, id))
  if (!card) notFound('Card not found')
  if (card.isTemplate) throw createError({ statusCode: 400, statusMessage: 'Templates cannot have a Matrix thread' })
  const target = link ? parseEventInput(link) : null
  if (link && !target) throw createError({ statusCode: 400, statusMessage: 'link: Enter a Matrix message link or event ID' })

  const inserted = await tx.insert(t).values({ cardId: id, boardId: card.boardId, roomId: '', eventId: '', createdBy: userId })
    .onConflictDoNothing().returning({ cardId: t.cardId })
  if (!inserted.length) throw createError({ statusCode: 409, statusMessage: 'The card already has a Matrix thread' })

  const bot = await boardMatrixBot(tx, card.boardId)
  let eventId: string
  try {
    if (target) {
      if (target.room && await resolveRoom(bot, target.room) !== bot.roomId) {
        throw createError({ statusCode: 400, statusMessage: 'That message is not in the board\'s Matrix room' })
      }
      eventId = await threadRootOf(bot, bot.roomId, target.eventId)
    }
    else {
      eventId = await sendMessage(bot, bot.roomId, cardThreadRoot(card, { id: card.boardId, name: card.boardName }, webhookSiteUrl()), `kanso-${randomUUID()}`)
    }
  }
  catch (e) {
    matrixHttpError(e, bot.botUserId)
  }
  await tx.update(t).set({ roomId: bot.roomId, eventId }).where(sql`${t.cardId} = ${id}`)
  return { roomId: bot.roomId, eventId }
})
