import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ email: z.email().max(254) })

/**
 * Mails a password reset link to any account with this email, including
 * OAuth-only ones (they can then also sign in with a password). Always 204, so
 * it does not reveal which emails exist.
 */
export default defineEventHandler(async (event) => {
  const { email } = await readValidated(event, body)
  await rateLimit(`forgot:${getRequestIP(event, { xForwardedFor: true })}`, 5)
  const [user] = await useAuthDb().select().from(schema.users).where(eq(schema.users.email, email))
  if (user) await sendPasswordResetEmail(event, user)
  setResponseStatus(event, 204)
  return null
})
