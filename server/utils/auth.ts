import type { H3Event } from 'h3'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'

type UserRow = typeof schema.users.$inferSelect

export function toSessionUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl }
}

const PENDING_TWO_FACTOR_MS = 5 * 60_000

/**
 * Signs `u` in after a first factor (password, OAuth, or an emailed link).
 * With two-factor on, only a short-lived pending state is stored and the
 * caller sends the browser to /login/2fa (POST /api/auth/two-factor finishes
 * it); `twoFactor` is then true.
 */
export async function startSession(event: H3Event, u: UserRow): Promise<{ twoFactor: boolean }> {
  if (await twoFactorEnabled(u.id)) {
    await revokeCurrentSession(event)
    await replaceUserSession(event, {
      secure: { pendingTwoFactor: { userId: u.id, version: u.sessionVersion, expiresAt: Date.now() + PENDING_TWO_FACTOR_MS } },
    })
    return { twoFactor: true }
  }
  await issueSession(event, u)
  return { twoFactor: false }
}

/**
 * The full session, once every factor is through (or for a user already
 * signed in whose session is renewed). Records a `user_sessions` row, whose id
 * the cookie carries, and revokes the row this browser had before (as does
 * the pending state above).
 */
export async function issueSession(event: H3Event, u: UserRow) {
  await bootstrapAdmin(u)
  await revokeCurrentSession(event)
  const db = useAuthDb()
  const [row] = await db.insert(schema.userSessions).values({
    userId: u.id,
    userAgent: getRequestHeader(event, 'user-agent')?.slice(0, 512) || null,
    ip: getRequestIP(event, { xForwardedFor: true })?.slice(0, 64) || null,
  }).returning({ id: schema.userSessions.id })
  // Revoked rows are kept a while for nothing but tidiness; drop old ones here.
  await db.delete(schema.userSessions).where(and(eq(schema.userSessions.userId, u.id), lt(schema.userSessions.revokedAt, sql`now() - interval '30 days'`)))
  // replaceUserSession: a stale sessionVersion must not survive the merge.
  await replaceUserSession(event, {
    user: toSessionUser(u), sessionVersion: u.sessionVersion, loggedInAt: Date.now(), secure: { sessionId: row!.id },
  })
}

/** Revokes the `user_sessions` row of the cookie this request carries, if any. Also run on sign-out (server/plugins/sessions.ts). */
export async function revokeSessionRow(id: string | undefined) {
  if (!id) return
  await useAuthDb().update(schema.userSessions).set({ revokedAt: new Date() })
    .where(and(eq(schema.userSessions.id, id), isNull(schema.userSessions.revokedAt)))
}

async function revokeCurrentSession(event: H3Event) {
  await revokeSessionRow((await getUserSession(event)).secure?.sessionId)
}

export interface OAuthProfile {
  provider: 'discord' | 'github' | 'google'
  providerUserId: string
  email: string | null | undefined
  emailVerified: boolean
  name: string
  avatarUrl: string | null
}

/**
 * Finds or creates the local user for an OAuth login. Linking to an existing
 * account and creating a new one both need an email the provider reports
 * verified; new accounts also pass the sign-up gate. An existing account whose
 * email was never confirmed is taken over: it is marked verified and its
 * password (set by whoever registered the address) is dropped.
 */
export async function upsertOAuthUser(p: OAuthProfile): Promise<UserRow> {
  const db = useAuthDb()
  return db.transaction(async (tx) => {
    const [linked] = await tx.select({ user: schema.users }).from(schema.oauthAccounts)
      .innerJoin(schema.users, eq(schema.users.id, schema.oauthAccounts.userId))
      .where(and(eq(schema.oauthAccounts.provider, p.provider), eq(schema.oauthAccounts.providerUserId, p.providerUserId)))
    if (linked) return linked.user

    if (!p.email) {
      throw createError({ statusCode: 400, statusMessage: `Your ${p.provider} account has no email address` })
    }

    let [user] = await tx.select().from(schema.users).where(eq(schema.users.email, p.email))
    if (user && !p.emailVerified) {
      throw createError({ statusCode: 409, statusMessage: 'An account with this email already exists. Sign in with it first.' })
    }
    if (!user) {
      if (!p.emailVerified) {
        throw createError({ statusCode: 403, statusMessage: `Verify your email address with ${p.provider} first` })
      }
      await assertSignupAllowed(p.email)
      ;[user] = await tx.insert(schema.users)
        .values({ email: p.email, name: p.name, avatarUrl: p.avatarUrl, emailVerifiedAt: new Date() })
        .returning()
    }
    else if (!user.emailVerifiedAt) {
      await assertSignupAllowed(p.email)
      ;[user] = await tx.update(schema.users)
        .set({ emailVerifiedAt: new Date(), passwordHash: null })
        .where(eq(schema.users.id, user.id))
        .returning()
    }
    await tx.insert(schema.oauthAccounts).values({ provider: p.provider, providerUserId: p.providerUserId, userId: user!.id })
    return user!
  })
}

/** Shared OAuth error handler: back to the login page with a message. */
export function oauthError(event: H3Event, error: { message?: string, statusMessage?: string }) {
  const message = error.statusMessage || error.message || 'Sign-in failed'
  return sendRedirect(event, appPath(`/login?error=${encodeURIComponent(message)}`))
}

/**
 * Counts an attempt against `key`: at most `limit` per window (default 10 per
 * 15 minutes), throwing 429 past that. Kept in Postgres (app.hit_rate_limit) so
 * it survives restarts and holds across instances.
 */
export async function rateLimit(key: string, limit = 10, windowMs = 15 * 60_000) {
  const [row] = await useAuthDb().execute<{ ok: boolean }>(
    sql`select app.hit_rate_limit(${key}, ${limit}, make_interval(secs => ${windowMs / 1000})) as ok`)
  if (!row?.ok) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts, try again later' })
  }
}
