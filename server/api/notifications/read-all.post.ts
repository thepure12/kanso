import { isNull } from 'drizzle-orm'

export default defineUserHandler(async (_event, tx) => {
  const { notifications: n } = schema
  const rows = await tx.update(n).set({ readAt: new Date() }).where(isNull(n.readAt)).returning({ id: n.id })
  return { updated: rows.length }
})
