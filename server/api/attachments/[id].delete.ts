import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardAttachments: ca } = schema
  const rows = await tx.delete(ca).where(eq(ca.id, id)).returning({ id: ca.id })
  if (!rows.length) notFound('Attachment not found or not allowed')
  return { ok: true }
})
