import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  email: z.email().max(254),
  password: z.string().max(200).optional(),
})

/**
 * Starts an email change: mails a link to the new address. Nothing changes
 * until the link is opened (GET /auth/confirm-email). Accounts with a
 * password confirm it first.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const { email, password } = await readValidated(event, body)
  await rateLimit(`email-change:${userId}`, 5)
  const db = useAuthDb()
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId))
  if (!user) throw createError({ statusCode: 401, statusMessage: 'This account no longer exists' })
  if (user.passwordHash && !(password && await verifyPassword(user.passwordHash, password))) {
    throw createError({ statusCode: 400, statusMessage: 'Your password is wrong' })
  }
  if (email.toLowerCase() === user.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'That is already your email' })
  }
  const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email))
  if (taken) throw createError({ statusCode: 409, statusMessage: 'Another account uses that email' })
  await sendEmailChangeEmail(event, user, email)
  return { sentTo: email }
})
