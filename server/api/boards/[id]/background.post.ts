import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { BoardBackground } from '#shared/boardBackgrounds'

const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024

/** Detects the image type from its first bytes; the browser's content type is not trusted. */
function imageType(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png'
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'image/jpeg'
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('latin1'))) return 'image/gif'
  return null
}

/** multipart/form-data with one `file` part: sets it as the board background (owners). */
export default defineUserHandler(async (event, tx): Promise<{ background: BoardBackground }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > MAX_BACKGROUND_BYTES + 64 * 1024) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 5 MB' })

  const file = (await readMultipartFormData(event) ?? []).find(p => p.name === 'file' && p.filename)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'No file' })
  if (file.data.length > MAX_BACKGROUND_BYTES) throw createError({ statusCode: 413, statusMessage: 'Image is larger than 5 MB' })
  const contentType = imageType(file.data)
  if (!contentType) throw createError({ statusCode: 400, statusMessage: 'Use a PNG, JPEG, WebP or GIF image' })

  const { boardBackgrounds: bb, boards } = schema
  const image = { contentType, size: file.data.length, data: file.data, createdAt: new Date() }
  // RLS: only owners of unarchived boards may insert or replace the image.
  await tx.insert(bb).values({ boardId: id, ...image }).onConflictDoUpdate({ target: bb.boardId, set: image })
  // A new token each time, so browsers fetch the new image.
  const background: BoardBackground = { kind: 'upload', value: randomBytes(6).toString('hex') }
  const [row] = await tx.update(boards).set({ background }).where(eq(boards.id, id)).returning({ id: boards.id })
  if (!row) notFound('Board not found or you are not an owner')
  return { background }
})
