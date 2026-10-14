import { and, eq, isNull } from 'drizzle-orm'

/** Signs a session out (user_sessions_revoke: own, unrevoked rows only). Revoking this one also clears the cookie. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const s = schema.userSessions
  const [row] = await tx.update(s).set({ revokedAt: new Date() })
    .where(and(eq(s.id, id), isNull(s.revokedAt))).returning({ id: s.id })
  if (!row) notFound('Session not found')
  const current = (await getUserSession(event)).secure?.sessionId === id
  if (current) clearSessionAfterCommit(event)
  return { current }
})
