import { sql } from 'drizzle-orm'
import type { Tx } from './db'

/**
 * API tokens are kept sealed next to their hash (api_tokens.token_enc, 0112),
 * so their owner, or a bot's manager, can see one again after a TOTP check.
 * Key: NUXT_TOTP_KEY or the session password, own HKDF info. Changing it makes
 * stored tokens unreadable (they still work, they just cannot be shown).
 */
function tokenKey() {
  const config = useRuntimeConfig()
  return secretKey(config.totpKey || config.session.password, 'kanban/api-token/v1')
}

export const sealApiToken = (token: string) => sealSecret(token, tokenKey())
export const openApiToken = (box: string) => openSecret(box, tokenKey())

/**
 * The token `tokenId` of `ownerId` (the caller, or a bot they manage) in
 * clear, after checking a TOTP code of the caller. Recovery codes do not
 * count. Two-factor off: 403 with `data.problem = 'twoFactorRequired'`.
 * Revoked, expired or unknown: 404 (app.reveal_api_token); made before
 * tokens were kept, or sealed with another key: 404 with `data.problem = 'notViewable'`.
 */
export async function revealApiToken(tx: Tx, userId: string, ownerId: string, tokenId: string, code: string): Promise<string> {
  if (!(await twoFactorEnabled(userId))) {
    throw createError({ statusCode: 403, statusMessage: 'Turn on two-factor authentication to view tokens', data: { problem: 'twoFactorRequired' } })
  }
  await rateLimit(`2fa:${userId}`)
  const [row] = await tx.execute<{ sealed: string | null }>(sql`select app.reveal_api_token(${tokenId}, ${ownerId}) as sealed`)
  if (!(await verifySecondFactor(userId, code, false))) {
    throw createError({ statusCode: 400, statusMessage: 'That code is not valid', data: { problem: 'badCode' } })
  }
  const token = row?.sealed ? openApiToken(row.sealed) : null
  if (!token) throw createError({ statusCode: 404, statusMessage: 'This token cannot be shown again', data: { problem: 'notViewable' } })
  return token
}
