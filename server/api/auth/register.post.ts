import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { pgCode } from '../../utils/errors'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(254),
  password: z.string().min(8).max(200),
})

/**
 * Creates an unverified account and mails a confirmation link; the account can
 * sign in (and claims its invites) only after the link is opened. Registering
 * again over an unverified email replaces its name and password, so nobody can
 * hold an address they do not own.
 */
export default defineEventHandler(async (event) => {
  const { name, email, password } = await readValidated(event, body)
  await rateLimit(`register:${getRequestIP(event, { xForwardedFor: true })}`)
  await assertSignupAllowed(email)
  const db = useAuthDb()
  const passwordHash = await hashPassword(password)
  let user: typeof schema.users.$inferSelect | undefined
  try {
    ;[user] = await db.insert(schema.users).values({ name, email, passwordHash }).returning()
  }
  catch (err) {
    if (pgCode(err) !== '23505') throw err
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email))
    if (existing?.emailVerifiedAt !== null) throw createError({ statusCode: 409, statusMessage: 'Email already registered' })
    ;[user] = await db.update(schema.users).set({ name, passwordHash })
      .where(eq(schema.users.id, existing.id)).returning()
  }
  await sendVerificationEmail(event, user!)
  return { verificationSent: true }
})
