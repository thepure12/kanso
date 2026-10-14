import { eq } from 'drizzle-orm'

// Shown in the browser; everything else downloads. No SVG or HTML: they can run script.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardAttachments: ca } = schema
  const [file] = await tx.select({ name: ca.name, contentType: ca.contentType, data: ca.data }).from(ca).where(eq(ca.id, id))
  if (!file) notFound('Attachment not found')

  const inline = INLINE_TYPES.has(file.contentType) && getQuery(event).download === undefined
  setResponseHeaders(event, {
    'content-type': inline ? file.contentType : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'content-security-policy': 'default-src \'none\'; sandbox',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
  })
  return file.data
})
