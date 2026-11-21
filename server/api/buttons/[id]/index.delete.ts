import { eq } from 'drizzle-orm'

/** Deletes a button. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { boardButtons: bb } = schema
  const rows = await tx.delete(bb).where(eq(bb.id, id)).returning({ id: bb.id })
  if (!rows.length) notFound('Button not found or not allowed')
  return { ok: true }
})
