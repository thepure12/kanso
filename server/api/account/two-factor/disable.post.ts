import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({
  password: z.string().max(200).optional(),
  code: z.string().trim().max(32).optional(),
})

/** Turns two-factor off. Needs the account password, or a code from the app or a recovery code. */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const { password, code } = await readValidated(event, body)
  await rateLimit(`2fa:${userId}`)
  const [user] = await useAuthDb().select().from(schema.users).where(eq(schema.users.id, userId))
  const passwordOk = !!(password && user?.passwordHash && await verifyPassword(user.passwordHash, password))
  if (!passwordOk && !(code && await verifySecondFactor(userId, code, true))) {
    throw createError({ statusCode: 400, statusMessage: password ? 'Your password is wrong' : 'That code is not valid' })
  }
  await disableTwoFactor(userId)
  return { ok: true }
})
