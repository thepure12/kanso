import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ read: z.boolean() })

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { read } = await readValidated(event, body)
  const { notifications: n } = schema
  const [row] = await tx.update(n).set({ readAt: read ? new Date() : null }).where(eq(n.id, id)).returning({ id: n.id })
  return row ?? notFound('Notification not found')
})
