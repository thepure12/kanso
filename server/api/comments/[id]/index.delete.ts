import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { cardComments: cc } = schema
  // RLS: the author or a board owner.
  const rows = await tx.delete(cc).where(eq(cc.id, id)).returning({ id: cc.id })
  if (!rows.length) notFound('Comment not found or not allowed')
  return { ok: true }
})
