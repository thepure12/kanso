import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { apiTokenScopes } from '#shared/webhooks'
import type { BotToken } from '#shared/types/bots'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(apiTokenScopes)).min(1).transform(s => [...new Set(s)]),
  // Null: never expires (like personal tokens).
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
})

/**
 * Creates an API token for a bot (app.create_bot_token: owners of its board or
 * team, limited to that board or team; an account bot's owner, then it
 * follows the bot's boards). The token is in this response; the
 * database keeps its sha256 and a sealed copy (see `reveal`). Cookie only, so a token never mints tokens.
 */
export default defineUserHandler(async (event, tx): Promise<BotToken & { token: string }> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name, scopes, expiresInDays } = await readValidated(event, body)
  const scope = await botScope(tx, id)
  const { token, hash, prefix } = generateApiToken()
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
  const [row] = await tx.execute<{ id: string }>(sql`
    select app.create_bot_token(${id}, ${name}, ${sql`array[${sql.join(scopes.map(s => sql`${s}`), sql`, `)}]::text[]`},
      ${expiresAt}::timestamptz, ${hash}, ${prefix}, ${sealApiToken(token)}) as id`)
  const created = (await loadManagedBot(tx, scope, id)).tokens?.find(t => t.id === row!.id)
  return { ...created!, token }
})
