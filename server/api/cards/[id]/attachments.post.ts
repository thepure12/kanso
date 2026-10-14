import type { Attachment } from '#shared/types/board'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** multipart/form-data with one or more `file` parts. */
export default defineUserHandler(async (event, tx, userId): Promise<Attachment[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > 5 * MAX_ATTACHMENT_BYTES) throw createError({ statusCode: 413, statusMessage: 'Upload too large' })

  const files = (await readMultipartFormData(event) ?? []).filter(p => p.name === 'file' && p.filename)
  if (!files.length) throw createError({ statusCode: 400, statusMessage: 'No file' })
  if (files.length > 5) throw createError({ statusCode: 400, statusMessage: 'At most 5 files at once' })
  for (const f of files) {
    if (f.data.length > MAX_ATTACHMENT_BYTES) throw createError({ statusCode: 413, statusMessage: `${f.filename} is larger than 10 MB` })
  }

  const boardId = await cardBoardId(tx, id)
  const { cardAttachments: ca } = schema
  const rows = await tx.insert(ca).values(files.map(f => ({
    cardId: id,
    boardId,
    name: f.filename!.slice(0, 255),
    contentType: (f.type || 'application/octet-stream').slice(0, 255),
    size: f.data.length,
    data: f.data,
    uploadedBy: userId,
  }))).returning({ id: ca.id, name: ca.name, contentType: ca.contentType, size: ca.size, uploadedBy: ca.uploadedBy, createdAt: ca.createdAt })
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }))
})
