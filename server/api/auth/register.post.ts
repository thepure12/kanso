import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { pgCode } from '../../utils/errors'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().min(8).max(200),
  /** Token from an invite mail (sendInviteEmail); proves the address, so no confirmation mail. */
  invite: z.string().max(1000).optional(),
})

/**
 * Creates an unverified account and mails a confirmation link; the account can
 * sign in (and claims its invites) only after the link is opened. Registering
 * again over an unverified email replaces its name and password, so nobody can
 * hold an address they do not own.
 *
 * With a valid invite token for the same email, the account is created
 * verified instead (claiming its invites) and signed in: `{ signedIn: true }`.
 */
export default defineEventHandler(async (event) => {
  const { name, email, password, invite } = await readValidated(event, body)
  await rateLimit(`register:${getRequestIP(event, { xForwardedFor: true })}`)
  await assertSignupAllowed(email)
  const claims = invite ? verifyEmailToken(invite, useRuntimeConfig().session.password, 'invite') : null
  const verified = claims?.email === email.toLowerCase() ? new Date() : null
  const db = useAuthDb()
  const passwordHash = await hashPassword(password)
  let user: typeof schema.users.$inferSelect | undefined
  try {
    ;[user] = await db.insert(schema.users).values({ name, email, passwordHash, emailVerifiedAt: verified }).returning()
  }
  catch (err) {
    if (pgCode(err) !== '23505') throw err
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    if (existing?.emailVerifiedAt !== null) throw createError({ statusCode: 409, statusMessage: 'Email already registered' })
    ;[user] = await db.update(schema.users).set({ name, passwordHash, emailVerifiedAt: verified })
      .where(eq(schema.users.id, existing.id)).returning()
  }
  if (verified) {
    const { twoFactor } = await startSession(event, user!)
    return { signedIn: true as const, twoFactor }
  }
  await sendVerificationEmail(event, user!)
  return { verificationSent: true as const }
})
