import { z } from 'zod'

const params = z.object({ id: z.uuid(), tokenId: z.uuid() })
const body = z.object({ code: z.string().trim().min(1).max(32) })

/**
 * One of a bot's live tokens in clear (kept sealed since 0112), for whoever
 * manages the bot (app.reveal_api_token through app.managed_bot_scope, else
 * 403), after a TOTP code from the caller's app (two-factor must be on).
 * Cookie only.
 */
export default defineUserHandler(async (event, tx, userId): Promise<{ token: string }> => {
  const { id, tokenId } = await paramsValidated(event, params)
  const { code } = await readValidated(event, body)
  await botScope(tx, id)
  return { token: await revealApiToken(tx, userId, id, tokenId, code) }
})
