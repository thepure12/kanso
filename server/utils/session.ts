import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

/** The session user's id and what withUser checks the session against. */
export async function requireSessionUser(event: H3Event): Promise<{ userId: string, session: SessionRef }> {
  const s = await requireUserSession(event)
  return { userId: s.user.id, session: { version: s.sessionVersion ?? 0, id: s.secure?.sessionId } }
}

/**
 * For handlers that do not run through withUser (kanban_auth credential
 * reads, event streams): the same live-session check, 401 and a cleared
 * cookie otherwise. Returns the user id.
 */
export async function requireLiveSession(event: H3Event): Promise<string> {
  const { userId, session } = await requireSessionUser(event)
  try {
    await useAuthDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
      await assertSessionLive(tx, session)
    })
  }
  catch (err) {
    if ((err as { statusCode?: number }).statusCode === 401) await clearUserSession(event)
    throw err
  }
  return userId
}

const clientIdPattern = /^[\w-]{1,64}$/

/** The browser tab's id (x-client-id header or ?client=), if valid. Tags board change notifications. */
export function clientIdOf(event: H3Event): string {
  const id = getHeader(event, 'x-client-id') ?? getQuery(event).client
  return typeof id === 'string' && clientIdPattern.test(id) ? id : ''
}

/**
 * Signs the browser out once the handler's transaction has committed. Clearing
 * inside it would deadlock: the sign-out hook revokes the session row on
 * another connection, waiting for locks this transaction holds.
 */
export function clearSessionAfterCommit(event: H3Event) {
  event.context.clearSessionAfterCommit = true
}

/**
 * Runs `fn` once the handler's transaction has committed (e.g. sending mail,
 * which should neither hold the transaction open nor undo it when it fails).
 * Failures are logged, not returned to the client.
 */
export function runAfterCommit(event: H3Event, fn: () => Promise<unknown>) {
  ((event.context.afterCommit ??= []) as (() => Promise<unknown>)[]).push(fn)
}

async function runAfterCommitTasks(event: H3Event) {
  const tasks = (event.context.afterCommit ?? []) as (() => Promise<unknown>)[]
  event.context.afterCommit = []
  for (const task of tasks) {
    try { await task() }
    catch (err) { console.error('[after-commit]', err) }
  }
}

/**
 * Personal access token auth (`Authorization: Bearer kb_...`) for
 * defineUserHandler: no cookie is read or set. Only allowed routes
 * (tokenRouteAllowed: no account, auth or admin routes) and, for read-only
 * tokens, GET/HEAD. Unknown, revoked and expired tokens are 401, and count
 * against a per-IP limit (429 past it).
 */
async function requireTokenUser(event: H3Event, token: string): Promise<{ userId: string, auth: RequestAuth }> {
  if (!tokenRouteAllowed((event.context.matchedRoute as { path?: string } | undefined)?.path)) {
    throw createError({ statusCode: 403, statusMessage: 'API tokens cannot be used for this route' })
  }
  const { userId, tokenId, scopes } = await resolveTokenUser(event, token)
  if (!tokenMethodAllowed(scopes, event.method)) {
    throw createError({ statusCode: 403, statusMessage: 'This API token is read-only' })
  }
  return { userId, auth: { tokenId } }
}

/**
 * The user, token id and scopes of a personal access token. Unknown, revoked
 * and expired tokens are 401 and count against a per-IP limit (429 past it).
 * No route or method check: callers do that (requireTokenUser) or forward the
 * token to routes that do (the MCP endpoint).
 */
export async function resolveTokenUser(event: H3Event, token: string): Promise<{ userId: string, tokenId: string, scopes: string[] }> {
  const [row] = await useAuthDb().execute<{ token_id: string, user_id: string, scopes: string[] }>(
    sql`select * from app.resolve_api_token(${hashApiToken(token)})`)
  if (!row) {
    await rateLimit(`token:${getRequestIP(event, { xForwardedFor: true }) ?? ''}`, 20)
    throw createError({ statusCode: 401, statusMessage: 'Invalid or expired API token' })
  }
  return { userId: row.user_id, tokenId: row.token_id, scopes: row.scopes }
}

/**
 * Authenticated handler that runs its body as the session user under RLS. A
 * Bearer token replaces the session cookie (see requireTokenUser); its
 * failures never touch the cookie.
 */
export function defineUserHandler<T>(fn: (event: H3Event, tx: Tx, userId: string) => Promise<T>) {
  return defineEventHandler(async (event) => {
    const token = bearerToken(getHeader(event, 'authorization'))
    const { userId, auth } = token === undefined
      ? await requireSessionUser(event).then(s => ({ userId: s.userId, auth: s.session as RequestAuth }))
      : await requireTokenUser(event, token)
    try {
      const result = await withUser(userId, tx => fn(event, tx, userId), clientIdOf(event), auth)
      if (event.context.clearSessionAfterCommit && token === undefined) await clearUserSession(event)
      await runAfterCommitTasks(event)
      return result
    }
    catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 401 && token === undefined) await clearUserSession(event)
      if (status) throw err
      toHttpError(err)
    }
  })
}

export const uuidParam = z.object({ id: z.uuid() })

/** #rrggbb in any case, stored lowercase. */
export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i).transform(c => c.toLowerCase())

/**
 * Parses the JSON body with `schema`. A failure is a 400 whose message names
 * the first problem (`title: Too big: ...`), with the zod issues in `data.issues`
 * so the client can show its own wording.
 */
export async function readValidated<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  const result = schema.safeParse(await readBody(event))
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.path.join('.')
  throw createError({
    statusCode: 400,
    statusMessage: issue ? (path ? `${path}: ${issue.message}` : issue.message) : 'Invalid request body',
    data: { issues: result.error.issues },
  })
}

export function paramsValidated<T extends z.ZodType>(event: H3Event, schema: T): Promise<z.infer<T>> {
  return getValidatedRouterParams(event, params => schema.parse(params))
}
