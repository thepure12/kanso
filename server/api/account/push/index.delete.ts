import { eq } from 'drizzle-orm'
import { z } from 'zod'

/** Turns push off for this browser (by its endpoint; push_subscriptions_delete: own rows). 204 also when it was not saved. */
export default defineUserHandler(async (event, tx) => {
  const { endpoint } = await readValidated(event, z.object({ endpoint: z.string().max(2000) }))
  await tx.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint))
  setResponseStatus(event, 204)
  return null
})
