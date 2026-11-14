import { eq } from 'drizzle-orm'
import type { MatrixThreadMessage, MatrixThreadView } from '#shared/types/matrix'

/**
 * The card's Matrix thread with its messages, read now from the homeserver
 * with the board's bot (card_matrix_threads_select and app.matrix_room_bot:
 * anyone on the board). No background sync: the dialog polls this while the
 * Matrix tab is open. Matrix problems are a 400 naming the error.
 */
export default defineUserHandler(async (event, tx): Promise<MatrixThreadView> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardMatrixThreads: t, boardMatrixRooms: r } = schema
  const [thread] = await tx.select({ boardId: t.boardId, roomId: t.roomId, eventId: t.eventId, botUserId: r.botUserId })
    .from(t).leftJoin(r, eq(r.boardId, t.boardId)).where(eq(t.cardId, id))
  if (!thread) notFound('The card has no Matrix thread')
  const bot = await boardMatrixBot(tx, thread.boardId)
  try {
    const { root, replies, more } = await loadThreadEvents(bot, thread.roomId, thread.eventId)
    const shown = [root, ...replies].flatMap((e) => {
      const content = messageContent(e)
      return content ? [{ e, content }] : []
    })
    const names = await memberNames(bot, thread.roomId, shown.map(m => m.e.sender))
    const messages: MatrixThreadMessage[] = shown.map(({ e, content }) => ({
      id: e.event_id,
      sender: e.sender,
      senderName: names.get(e.sender) ?? e.sender,
      fromBot: e.sender === thread.botUserId,
      createdAt: new Date(e.origin_server_ts).toISOString(),
      ...content,
    }))
    return { roomId: thread.roomId, eventId: thread.eventId, messages, more }
  }
  catch (e) {
    matrixHttpError(e)
  }
})
