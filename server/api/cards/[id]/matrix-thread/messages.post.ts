import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { MatrixThreadMessage } from '#shared/types/matrix'
import type { KansoAuthor } from '../../../../utils/matrix'

const body = z.object({
  text: z.string().trim().min(1).max(10_000),
  /** Set once per written message, so a retried request does not post twice. */
  clientId: z.uuid(),
})

/**
 * Replies in the card's Matrix thread as the board's bot, signed with the
 * caller's name (app.matrix_thread_reply_target: people who can edit the
 * board). Rate limited per person. Matrix problems are a 400 naming the error.
 */
export default defineUserHandler(async (event, tx, userId): Promise<MatrixThreadMessage> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { text, clientId } = await readValidated(event, body)
  const [target] = await tx.execute<{ homeserver_url: string, room_id: string, event_id: string, access_token: string }>(
    sql`select * from app.matrix_thread_reply_target(${id})`)
  if (!target) notFound('The card has no Matrix thread you can reply to')
  await rateLimit(`matrix-reply:${userId}`, 30, 60_000)
  const accessToken = openMatrixToken(target.access_token)
  if (!accessToken) throw createError({ statusCode: 400, statusMessage: 'Matrix: the stored token cannot be read any more. A board owner has to enter it again.' })
  const [me] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId))
  // The caller's verified Matrix account on the card's board: the reply starts with a silent pill of it.
  const { boardMatrixUsers: u, cards } = schema
  const [link] = await tx.select({ mxid: u.mxid }).from(u).innerJoin(cards, eq(cards.boardId, u.boardId))
    .where(and(eq(cards.id, id), eq(u.userId, userId), isNotNull(u.verifiedAt)))
  const [room] = await tx.select({ botUserId: schema.boardMatrixRooms.botUserId }).from(schema.boardMatrixRooms)
    .innerJoin(cards, eq(cards.boardId, schema.boardMatrixRooms.boardId)).where(eq(cards.id, id))
  const author: KansoAuthor = { id: userId, name: me?.name ?? 'Kanso', ...(link && { mxid: link.mxid }) }
  const client = { homeserverUrl: target.homeserver_url, accessToken }
  // Several replies in a row from one person carry the author line only on the first.
  const continued = !!room && await threadEndsWithAuthor(client, target.room_id, target.event_id, room.botUserId, userId)
  const content = threadReplyContent(target.event_id, author, text, continued)
  try {
    const eventId = await sendMessage(client, target.room_id, content, `kanso-${userId}-${clientId}`)
    return {
      id: eventId,
      sender: '',
      senderName: author.name,
      fromBot: true,
      kansoAuthorId: userId,
      kansoUserId: userId,
      createdAt: new Date().toISOString(),
      body: text,
      html: null,
      edited: false,
    }
  }
  catch (e) {
    matrixHttpError(e)
  }
})
