import { eq } from 'drizzle-orm'

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const rows = await tx.delete(schema.boards).where(eq(schema.boards.id, id)).returning({ id: schema.boards.id })
  if (!rows.length) notFound('Board not found or you are not an owner')
  return { ok: true }
})
