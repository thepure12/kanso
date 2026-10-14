import { z } from 'zod'

const body = z.object({ code: z.string().trim().min(1).max(32) })

/** New recovery codes (the old ones stop working). Needs a current code from the app, not a recovery code. */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const { code } = await readValidated(event, body)
  await rateLimit(`2fa:${userId}`)
  if (!(await verifySecondFactor(userId, code, false))) {
    throw createError({ statusCode: 400, statusMessage: 'That code is not valid' })
  }
  return { recoveryCodes: await replaceRecoveryCodes(userId) }
})
