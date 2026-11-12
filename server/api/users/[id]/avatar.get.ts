import { eq } from 'drizzle-orm'

/** A user's uploaded profile picture (anyone who can see the user). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { userAvatars: ua } = schema
  const [image] = await tx.select({ contentType: ua.contentType, data: ua.data }).from(ua).where(eq(ua.userId, id))
  if (!image) notFound('No profile picture')

  setResponseHeaders(event, {
    // Only image types get stored (user_avatars_type).
    'content-type': image.contentType,
    'content-security-policy': 'default-src \'none\'; sandbox',
    'x-content-type-options': 'nosniff',
    // The URL carries a token that changes with each upload.
    'cache-control': 'private, max-age=31536000, immutable',
  })
  return image.data
})
