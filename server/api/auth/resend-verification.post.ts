import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ email: z.email().max(254) })

/** Mails a new confirmation link to an unverified password account. Always 204, so it does not reveal which emails exist. */
export default defineEventHandler(async (event) => {
  const { email } = await readValidated(event, body)
  await rateLimit(`resend:${getRequestIP(event, { xForwardedFor: true })}`, 5)
  const [user] = await useAuthDb().select().from(schema.users).where(eq(schema.users.email, email))
  if (user?.passwordHash && !user.emailVerifiedAt) await sendVerificationEmail(event, user)
  setResponseStatus(event, 204)
  return null
})
