import { eq } from 'drizzle-orm'

/** The custom view's uploaded background image (only its user). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { customViewBackgrounds: vb } = schema
  const [image] = await tx.select({ contentType: vb.contentType, data: vb.data }).from(vb).where(eq(vb.viewId, id))
  if (!image) notFound('No background image')

  setResponseHeaders(event, {
    // Only image types get stored (custom_view_backgrounds_type).
    'content-type': image.contentType,
    'content-security-policy': 'default-src \'none\'; sandbox',
    'x-content-type-options': 'nosniff',
    // The URL carries a token that changes with each upload.
    'cache-control': 'private, max-age=31536000, immutable',
  })
  return image.data
})
