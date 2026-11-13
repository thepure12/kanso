import { eq } from 'drizzle-orm'

/** Removes one of the user's push devices (push_subscriptions_delete: own rows). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const p = schema.pushSubscriptions
  const [row] = await tx.delete(p).where(eq(p.id, id)).returning({ id: p.id })
  if (!row) notFound('Push device not found')
  setResponseStatus(event, 204)
  return null
})
