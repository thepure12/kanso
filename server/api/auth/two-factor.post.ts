import { eq } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ code: z.string().trim().min(1).max(32) })

/**
 * Second sign-in step: a TOTP or recovery code for the pending sign-in that
 * startSession stored (5 minutes). Attempts count per account, so a new
 * password login does not reset them.
 */
export default defineEventHandler(async (event) => {
  const { code } = await readValidated(event, body)
  const pending = (await getUserSession(event)).secure?.pendingTwoFactor
  const startOver = async () => {
    await clearUserSession(event)
    return createError({ statusCode: 401, statusMessage: 'Your sign-in expired. Sign in again.' })
  }
  if (!pending || pending.expiresAt < Date.now()) throw await startOver()
  await rateLimit(`2fa:${pending.userId}`)

  const [user] = await useAuthDb().select().from(schema.users).where(eq(schema.users.id, pending.userId))
  // A password reset or email change since the first step voids it.
  if (!user || user.sessionVersion !== pending.version) throw await startOver()
  const method = await verifySecondFactor(user.id, code, true)
  if (!method) throw createError({ statusCode: 400, statusMessage: 'That code is not valid' })
  await issueSession(event, user)
  return {
    user: toSessionUser(user),
    recoveryCodesLeft: method === 'recovery' ? await recoveryCodesLeft(user.id) : undefined,
  }
})
