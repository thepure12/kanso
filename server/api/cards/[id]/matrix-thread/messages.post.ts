import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { MatrixThreadMessage } from '#shared/types/matrix'

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
  const author = { id: userId, name: me?.name ?? 'Kanso' }
  const content = threadReplyContent(target.event_id, author, text)
  try {
    const eventId = await sendMessage({ homeserverUrl: target.homeserver_url, accessToken }, target.room_id, content, `kanso-${userId}-${clientId}`)
    return {
      id: eventId,
      sender: '',
      senderName: author.name,
      fromBot: true,
      kansoAuthorId: userId,
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
