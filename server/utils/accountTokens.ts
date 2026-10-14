import type { ApiToken } from '#shared/types/account'
import * as schema from '../db/schema'

const t = schema.apiTokens

/** What kanban_app may read of api_tokens (no token_hash). */
export const apiTokenColumns = {
  id: t.id, name: t.name, prefix: t.prefix, scopes: t.scopes, createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt,
}

export function toApiToken(r: { id: string, name: string, prefix: string, scopes: string[], createdAt: Date, lastUsedAt: Date | null, expiresAt: Date | null, revokedAt: Date | null }): ApiToken {
  return {
    id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes as ApiToken['scopes'], createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null,
  }
}
