import { desc } from 'drizzle-orm'
import type { ApiToken } from '#shared/types/account'

/** The signed-in user's API tokens, revoked ones included (api_tokens_select: own rows only). */
export default defineUserHandler(async (_event, tx): Promise<ApiToken[]> => {
  const rows = await tx.select(apiTokenColumns).from(schema.apiTokens).orderBy(desc(schema.apiTokens.createdAt))
  return toApiTokens(tx, rows)
})
