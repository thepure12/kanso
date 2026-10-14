import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  token: z.string().min(1).max(2000),
  password: z.string().min(8).max(200),
})

/**
 * Sets a new password from a reset link and signs in. Opening the link proves
 * the inbox, so an unverified account becomes verified (after the sign-up
 * gate). The session version goes up: the link works once and other sessions
 * are signed out, and API tokens revoked (whoever had the account may have
 * made some). Two-factor still applies: the page then continues at /login/2fa.
 */
export default defineEventHandler(async (event) => {
  const { token, password } = await readValidated(event, body)
  await rateLimit(`reset:${getRequestIP(event, { xForwardedFor: true })}`)
  const claims = verifyEmailToken(token, useRuntimeConfig().session.password, 'password-reset')
  const invalid = () => createError({ statusCode: 400, statusMessage: 'This reset link is invalid or has expired. Ask for a new one.' })
  if (!claims || claims.version === undefined) throw invalid()

  const db = useAuthDb()
  const match = and(eq(schema.users.id, claims.userId), eq(schema.users.email, claims.email), eq(schema.users.sessionVersion, claims.version))
  const [user] = await db.select().from(schema.users).where(match)
  if (!user) throw invalid()
  if (!user.emailVerifiedAt) await assertSignupAllowed(user.email)

  const [updated] = await db.update(schema.users).set({
    passwordHash: await hashPassword(password),
    emailVerifiedAt: sql`coalesce(${schema.users.emailVerifiedAt}, now())`,
    sessionVersion: sql`${schema.users.sessionVersion} + 1`,
  }).where(match).returning()
  if (!updated) throw invalid()
  await db.execute(sql`select app.revoke_api_tokens(${updated.id})`)
  const { twoFactor } = await startSession(event, updated)
  return twoFactor ? { twoFactor } : toSessionUser(updated)
})
