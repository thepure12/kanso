import { eq } from 'drizzle-orm'

/** Deletes a checklist with its items. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { checklists: cl } = schema
  const rows = await tx.delete(cl).where(eq(cl.id, id)).returning({ id: cl.id })
  if (!rows.length) notFound('Checklist not found or not allowed')
  return { ok: true }
})
