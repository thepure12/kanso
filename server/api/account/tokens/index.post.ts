import { z } from 'zod'
import { apiTokenScopes } from '#shared/webhooks'
import type { ApiToken } from '#shared/types/account'

const body = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(apiTokenScopes)).min(1).transform(s => [...new Set(s)]),
  // Null: never expires.
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
  // Null: every board the user can see. Otherwise boards they can see (api_tokens_insert, else 403).
  boardIds: z.array(z.uuid()).min(1).max(100).transform(s => [...new Set(s)]).nullable().default(null),
})

/** Creates a token for the signed-in user. The token is in this response only; the database keeps its sha256. */
export default defineUserHandler(async (event, tx, userId): Promise<ApiToken & { token: string }> => {
  const { name, scopes, expiresInDays, boardIds } = await readValidated(event, body)
  const { token, hash, prefix } = generateApiToken()
  const t = schema.apiTokens
  const [row] = await tx.insert(t).values({
    userId, name, scopes, boardIds, tokenHash: hash, prefix,
    expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000),
  }).returning(apiTokenColumns)
  const [created] = await toApiTokens(tx, [row!])
  return { ...created!, token }
})
