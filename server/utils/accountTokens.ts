import { inArray } from 'drizzle-orm'
import type { ApiToken } from '#shared/types/account'
import * as schema from '../db/schema'
import type { Tx } from './db'

const t = schema.apiTokens

/** What kanban_app may read of api_tokens (no token_hash). */
export const apiTokenColumns = {
  id: t.id, name: t.name, prefix: t.prefix, scopes: t.scopes, boardIds: t.boardIds, createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revokedAt: t.revokedAt,
}

type ApiTokenRow = { id: string, name: string, prefix: string, scopes: string[], boardIds: string[] | null, createdAt: Date, lastUsedAt: Date | null, expiresAt: Date | null, revokedAt: Date | null }

/**
 * Tokens as the API returns them, with the names of the boards limited ones
 * reach. Boards since deleted or left drop out of the list (they still count
 * for the limit, which never widens).
 */
export async function toApiTokens(tx: Tx, rows: ApiTokenRow[]): Promise<ApiToken[]> {
  const ids = [...new Set(rows.flatMap(r => r.boardIds ?? []))]
  const names = new Map(ids.length
    ? (await tx.select({ id: schema.boards.id, name: schema.boards.name }).from(schema.boards).where(inArray(schema.boards.id, ids)))
        .map(b => [b.id, b.name])
    : [])
  return rows.map(r => ({
    id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes as ApiToken['scopes'],
    boards: r.boardIds && r.boardIds.flatMap(id => names.has(id) ? [{ id, name: names.get(id)! }] : []),
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null,
  }))
}
