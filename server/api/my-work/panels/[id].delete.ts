import { eq } from 'drizzle-orm'

/** Deletes a My work panel. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { myWorkPanels: p } = schema
  const rows = await tx.delete(p).where(eq(p.id, id)).returning({ id: p.id })
  if (!rows.length) notFound('Panel not found')
  return { ok: true }
})
