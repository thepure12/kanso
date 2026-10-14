import { and, isNull, ne } from 'drizzle-orm'

/** Signs out every session of the user but this one. */
export default defineUserHandler(async (event, tx) => {
  const current = (await getUserSession(event)).secure?.sessionId
  const s = schema.userSessions
  const rows = await tx.update(s).set({ revokedAt: new Date() })
    .where(and(isNull(s.revokedAt), ne(s.id, current!))).returning({ id: s.id })
  return { revoked: rows.length }
})
