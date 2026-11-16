import { eq } from 'drizzle-orm'
import { z } from 'zod'

const query = z.object({
  mxc: z.string().max(500),
  sig: z.string().max(100),
  thumbnail: z.literal('1').optional(),
})

// Shown in the browser; anything else downloads. No SVG: it can run script.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * An image of the card's Matrix thread, fetched now by the board's bot
 * (`thumbnail=1`: at most 800×600). The thread must be visible to the caller
 * (card_matrix_threads_select), and `sig` must be the one the thread GET put
 * in the URL for this card and mxc URI, so only media of the thread is
 * served. Matrix problems are a 400 naming the error.
 */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const parsed = query.safeParse(getQuery(event))
  if (!parsed.success || !checkMatrixMediaSig(id, parsed.data.mxc, parsed.data.sig)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid media link' })
  }
  const { cardMatrixThreads: t } = schema
  const [thread] = await tx.select({ boardId: t.boardId }).from(t).where(eq(t.cardId, id))
  if (!thread) notFound('The card has no Matrix thread')
  const bot = await boardMatrixBot(tx, thread.boardId)
  let media: Awaited<ReturnType<typeof downloadMatrixMedia>>
  try {
    media = await downloadMatrixMedia(bot, parsed.data.mxc, !!parsed.data.thumbnail)
  }
  catch (e) {
    matrixHttpError(e, bot.botUserId)
  }
  const inline = !!media.contentType && INLINE_TYPES.has(media.contentType)
  setResponseHeaders(event, {
    'content-type': inline ? media.contentType! : 'application/octet-stream',
    'content-disposition': inline ? 'inline' : 'attachment',
    'content-security-policy': 'default-src \'none\'; sandbox',
    'x-content-type-options': 'nosniff',
    // Media never changes, but access can end: keep it in this browser only, briefly.
    'cache-control': 'private, max-age=3600',
  })
  return media.data
})
