import { eq } from 'drizzle-orm'

/** The board's uploaded background image (anyone who can see the board). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { boardBackgrounds: bb } = schema
  const [image] = await tx.select({ contentType: bb.contentType, data: bb.data }).from(bb).where(eq(bb.boardId, id))
  if (!image) notFound('No background image')

  setResponseHeaders(event, {
    // Only image types get stored (board_backgrounds_type).
    'content-type': image.contentType,
    'content-security-policy': 'default-src \'none\'; sandbox',
    'x-content-type-options': 'nosniff',
    // The URL carries a token that changes with each upload.
    'cache-control': 'private, max-age=31536000, immutable',
  })
  return image.data
})
