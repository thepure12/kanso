import { eq } from 'drizzle-orm'
import type { MatrixThreadImage, MatrixThreadMessage, MatrixThreadView } from '#shared/types/matrix'
import type { ThreadImage } from '../../../../utils/matrix'

/** Signed media route URLs for an image of the card's thread. */
function threadImage(cardId: string, image: ThreadImage): MatrixThreadImage {
  const url = `/api/cards/${cardId}/matrix-thread/media?mxc=${encodeURIComponent(image.mxc)}&sig=${matrixMediaSig(cardId, image.mxc)}`
  return { url, thumbnailUrl: `${url}&thumbnail=1`, name: image.name, width: image.width, height: image.height }
}

/**
 * The card's Matrix thread with its messages, read now from the homeserver
 * with the board's bot (card_matrix_threads_select and app.matrix_room_bot:
 * anyone on the board). No background sync: the dialog polls this while the
 * Matrix tab is open. Matrix problems are a 400 naming the error.
 */
export default defineUserHandler(async (event, tx, userId): Promise<MatrixThreadView> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardMatrixThreads: t, boardMatrixRooms: r } = schema
  const [thread] = await tx.select({ boardId: t.boardId, roomId: t.roomId, eventId: t.eventId, botUserId: r.botUserId })
    .from(t).leftJoin(r, eq(r.boardId, t.boardId)).where(eq(t.cardId, id))
  if (!thread) notFound('The card has no Matrix thread')
  const bot = await boardMatrixBot(tx, thread.boardId)
  const [linked, myLink] = await Promise.all([loadBoardMatrixUsers(tx, thread.boardId), loadMyMatrixLink(tx, thread.boardId, userId)])
  try {
    const { root, replies, more } = await loadThreadEvents(bot, thread.roomId, thread.eventId)
    const shown = [root, ...replies].flatMap((e) => {
      const content = messageContent(e)
      return content ? [{ e, content }] : []
    })
    const names = await memberNames(bot, thread.roomId, shown.map(m => m.e.sender))
    const messages: MatrixThreadMessage[] = shown.map(({ e, content }) => {
      const fromBot = e.sender === thread.botUserId
      const author = fromBot ? kansoAuthor(e) : null
      return {
        id: e.event_id,
        sender: e.sender,
        senderName: author?.name ?? names.get(e.sender) ?? e.sender,
        fromBot,
        kansoAuthorId: author?.id ?? null,
        kansoUserId: author?.id ?? (fromBot ? null : linked.get(e.sender) ?? null),
        createdAt: new Date(e.origin_server_ts).toISOString(),
        ...(author && !author.continued ? withoutAuthorPrefix(content, author) : content),
        image: content.image && threadImage(id, content.image),
      }
    })
    return { boardId: thread.boardId, roomId: thread.roomId, eventId: thread.eventId, messages, more, myLink }
  }
  catch (e) {
    matrixHttpError(e, thread.botUserId ?? bot.botUserId)
  }
})
