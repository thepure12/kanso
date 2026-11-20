import { sql } from 'drizzle-orm'
import { z } from 'zod'

const params = z.object({ id: z.uuid(), tokenId: z.uuid() })

/** Revokes one of a bot's tokens (app.revoke_bot_token: owners of its board or team; already revoked: no-op). Cookie only. */
export default defineUserHandler(async (event, tx) => {
  const { id, tokenId } = await paramsValidated(event, params)
  await botScope(tx, id)
  // app.bot_tokens refuses non-owners (403) before telling whether the token is the bot's.
  const [row] = await tx.execute(sql`select 1 from app.bot_tokens(${id}) t where t.id = ${tokenId}`)
  if (!row) notFound('Token not found')
  await tx.execute(sql`select app.revoke_bot_token(${tokenId})`)
  return { ok: true }
})
