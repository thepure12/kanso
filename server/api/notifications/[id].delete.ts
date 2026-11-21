import { eq } from 'drizzle-orm'

/** Removes one of the caller's notifications from their inbox (RLS: own rows only). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { notifications: n } = schema
  const [row] = await tx.delete(n).where(eq(n.id, id)).returning({ id: n.id })
  return row ?? notFound('Notification not found')
})
