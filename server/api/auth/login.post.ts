import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
  const { email, password } = await readValidated(event, body)
  await rateLimit(`login:${getRequestIP(event, { xForwardedFor: true })}:${email.toLowerCase()}`)

  const [user] = await useAuthDb().select().from(schema.users).where(eq(schema.users.email, email))
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }
  // Checked after the password, so it reveals nothing to someone without it.
  if (!user.emailVerifiedAt) {
    throw createError({ statusCode: 403, statusMessage: 'Confirm your email first. Check your inbox for the link.' })
  }
  // With two-factor on, the page continues at /login/2fa.
  const { twoFactor } = await startSession(event, user)
  return twoFactor ? { twoFactor } : toSessionUser(user)
})
