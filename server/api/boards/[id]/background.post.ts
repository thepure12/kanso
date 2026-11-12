import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { BoardBackground } from '#shared/boardBackgrounds'

const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024

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
