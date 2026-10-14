import { and, eq, isNull } from 'drizzle-orm'

/** Confirmation link from the sign-up email: marks the email verified, claims invites, signs in. */
export default defineEventHandler(async (event) => {
  try {
    const token = getQuery(event).token
    const claims = typeof token === 'string' ? verifyEmailToken(token, useRuntimeConfig().session.password) : null
    if (!claims) throw createError({ statusCode: 400, statusMessage: 'This confirmation link is invalid or has expired. Sign up again to get a new one.' })

    const db = useAuthDb()
    const [user] = await db.select().from(schema.users)
      .where(and(eq(schema.users.id, claims.userId), eq(schema.users.email, claims.email)))
    if (!user) throw createError({ statusCode: 400, statusMessage: 'This confirmation link is no longer valid.' })

    if (!user.emailVerifiedAt) {
      // The allowlist may have changed since the link was sent.
      await assertSignupAllowed(user.email)
      await db.update(schema.users).set({ emailVerifiedAt: new Date() })
        .where(and(eq(schema.users.id, user.id), isNull(schema.users.emailVerifiedAt)))
    }
    // The link stays valid for a day, so it must not skip two-factor.
    const { twoFactor } = await startSession(event, user)
    return sendRedirect(event, twoFactor ? '/login/2fa' : '/')
  }
  catch (error) {
    return oauthError(event, error as { message?: string, statusMessage?: string })
  }
})
