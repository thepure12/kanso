import { desc, isNull } from 'drizzle-orm'
import type { AccountSession } from '#shared/types/account'

/** The signed-in user's live sessions (user_sessions_select: own rows only). */
export default defineUserHandler(async (event, tx): Promise<AccountSession[]> => {
  const current = (await getUserSession(event)).secure?.sessionId
  const s = schema.userSessions
  const rows = await tx.select({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, ip: s.ip })
    .from(s).where(isNull(s.revokedAt)).orderBy(desc(s.lastSeenAt))
  return rows.map(r => ({
    ...r, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), current: r.id === current,
  }))
})
