import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../db/schema'

export { schema }

type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

let appDb: Db | undefined
let authDbInstance: Db | undefined

function connect(url: string): Db {
  if (!url) throw new Error('Database URL is not configured')
  return drizzle(postgres(url, { max: 10, onnotice: () => {} }), { schema })
}

/** What withUser checks a session against: the account's session version and the `user_sessions` row. */
export interface SessionRef { version: number, id: string | undefined }

/**
 * How a request authenticated: a session, or an API token app.resolve_api_token
 * has already checked, with the boards it is limited to (null = all).
 */
export type RequestAuth = SessionRef | { tokenId: string, boardIds: string[] | null }

/**
 * Runs `fn` in a transaction as `userId`. Connects as the RLS-restricted
 * kanban_app role; the identity is transaction-local so pooled connections
 * never leak it. `clientId` (the browser tab) goes into board change
 * notifications so a tab can skip its own changes. The session must still be
 * live (app.check_session): the account exists, its session version matches
 * (a password or email change signs out older sessions) and the session row
 * is not revoked. API token requests skip that check (the token was checked
 * when it was resolved) and set app.token_boards, which app.board_role
 * reads to keep a limited token to its boards.
 */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, clientId: string, auth: RequestAuth): Promise<T> {
  appDb ??= connect(useRuntimeConfig().databaseUrl)
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true), set_config('app.client_id', ${clientId}, true)`)
    if (!('tokenId' in auth)) await assertSessionLive(tx, auth)
    else if (auth.boardIds) await tx.execute(sql`select set_config('app.token_boards', ${`{${auth.boardIds.join(',')}}`}, true)`)
    return fn(tx)
  })
}

/** Throws 401 unless app.check_session says the session is live. Needs app.user_id set in `tx`. */
export async function assertSessionLive(tx: Tx, session: SessionRef) {
  const [row] = await tx.execute<{ s: string }>(sql`select app.check_session(${session.id ?? null}::uuid, ${session.version}) as s`)
  if (row?.s === 'gone') throw createError({ statusCode: 401, statusMessage: 'This account no longer exists' })
  if (row?.s !== 'ok') throw createError({ statusCode: 401, statusMessage: 'Your session has expired. Sign in again.' })
}

/** Connection for login / register / OAuth only (kanban_auth role). */
export function useAuthDb(): Db {
  authDbInstance ??= connect(useRuntimeConfig().authDatabaseUrl)
  return authDbInstance
}
