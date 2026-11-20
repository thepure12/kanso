import { z } from 'zod'

const body = z.object({ code: z.string().trim().min(1).max(32) })

/**
 * One of the signed-in user's live tokens in clear (kept sealed since 0112),
 * after a TOTP code from their app (two-factor must be on). Cookie only
 * (account routes refuse tokens).
 */
export default defineUserHandler(async (event, tx, userId): Promise<{ token: string }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { code } = await readValidated(event, body)
  return { token: await revealApiToken(tx, userId, userId, id, code) }
})
