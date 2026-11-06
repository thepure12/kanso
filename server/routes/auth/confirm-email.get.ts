import { and, eq, sql } from 'drizzle-orm'
import { pgCode } from '../../utils/errors'

/**
 * Link from an email change: switches the account to the new address (proven
 * by the link, so it is verified), claims invites sent to it and signs in
 * again. Other sessions are signed out. The token is bound to the session
 * version, so it works once.
 */
export default defineEventHandler(async (event) => {
  const back = (message: string) => sendRedirect(event, appPath(`/account?error=${encodeURIComponent(message)}`))
  const token = getQuery(event).token
  const claims = typeof token === 'string' ? verifyEmailToken(token, useRuntimeConfig().session.password, 'email-change') : null
  if (!claims || claims.version === undefined) return back('This confirmation link is invalid or has expired.')

  const db = useAuthDb()
  let user: typeof schema.users.$inferSelect | undefined
  try {
    ;[user] = await db.update(schema.users)
      .set({ email: claims.email, emailVerifiedAt: sql`now()`, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(and(eq(schema.users.id, claims.userId), eq(schema.users.sessionVersion, claims.version)))
      .returning()
  }
  catch (err) {
    if (pgCode(err) === '23505') return back('Another account uses that email now.')
    throw err
  }
  if (!user) return back('This confirmation link is no longer valid.')
  const { twoFactor } = await startSession(event, user)
  return sendRedirect(event, appPath(twoFactor ? '/login/2fa' : '/account?emailChanged=1'))
})
