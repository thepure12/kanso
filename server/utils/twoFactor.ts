import { and, count, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { renderSVG } from 'uqr'

/**
 * Two-factor authentication (TOTP plus one-time recovery codes). Secrets and
 * codes live in user_totp / user_recovery_codes, which only kanban_auth can
 * touch, so everything here goes through useAuthDb() after the caller has
 * checked the session (or the pending sign-in).
 */

function totpKey() {
  const config = useRuntimeConfig()
  return secretKey(config.totpKey || config.session.password)
}

export async function twoFactorEnabled(userId: string): Promise<boolean> {
  const [row] = await useAuthDb().select({ userId: schema.userTotp.userId }).from(schema.userTotp)
    .where(and(eq(schema.userTotp.userId, userId), isNotNull(schema.userTotp.enabledAt)))
  return !!row
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const [row] = await useAuthDb().select({ n: count() }).from(schema.userRecoveryCodes)
    .where(and(eq(schema.userRecoveryCodes.userId, userId), isNull(schema.userRecoveryCodes.usedAt)))
  return row?.n ?? 0
}

/**
 * Starts (or restarts) setup: a new secret, not yet enabled. Returns null when
 * two-factor is already on.
 */
export async function beginTotpSetup(user: { id: string, email: string }) {
  const secret = generateTotpSecret()
  const secretEnc = sealSecret(secret, totpKey())
  const [row] = await useAuthDb().insert(schema.userTotp).values({ userId: user.id, secretEnc })
    .onConflictDoUpdate({
      target: schema.userTotp.userId,
      set: { secretEnc, lastUsedStep: null, createdAt: new Date() },
      setWhere: isNull(schema.userTotp.enabledAt),
    })
    .returning({ userId: schema.userTotp.userId })
  if (!row) return null
  const uri = totpUri(secret, user.email, 'Kanso')
  const qr = `data:image/svg+xml;base64,${Buffer.from(renderSVG(uri, { border: 2 })).toString('base64')}`
  return { secret, uri, qr }
}

/** Accepts the first code from the app: turns two-factor on. False when the code is wrong or there is no setup. */
export async function confirmTotpSetup(userId: string, code: string): Promise<boolean> {
  const db = useAuthDb()
  const [row] = await db.select().from(schema.userTotp)
    .where(and(eq(schema.userTotp.userId, userId), isNull(schema.userTotp.enabledAt)))
  const secret = row && openSecret(row.secretEnc, totpKey())
  const step = secret ? verifyTotp(secret, code) : null
  if (step === null) return false
  const [done] = await db.update(schema.userTotp).set({ enabledAt: new Date(), lastUsedStep: step })
    .where(and(eq(schema.userTotp.userId, userId), isNull(schema.userTotp.enabledAt)))
    .returning({ userId: schema.userTotp.userId })
  return !!done
}

/**
 * Checks a second factor: a TOTP code (six digits) or, when allowed, an unused
 * recovery code, which is then spent. Each TOTP code works once: its step
 * must be newer than the last one accepted (claimed atomically, so two
 * concurrent requests cannot both use it).
 */
export async function verifySecondFactor(userId: string, code: string, allowRecovery: boolean): Promise<'totp' | 'recovery' | null> {
  const db = useAuthDb()
  const given = code.trim()
  if (/^[\d\s]+$/.test(given)) {
    const [row] = await db.select().from(schema.userTotp)
      .where(and(eq(schema.userTotp.userId, userId), isNotNull(schema.userTotp.enabledAt)))
    const secret = row && openSecret(row.secretEnc, totpKey())
    const step = secret ? verifyTotp(secret, given) : null
    if (step === null) return null
    const [claimed] = await db.update(schema.userTotp).set({ lastUsedStep: step })
      .where(and(eq(schema.userTotp.userId, userId), isNotNull(schema.userTotp.enabledAt),
        or(isNull(schema.userTotp.lastUsedStep), lt(schema.userTotp.lastUsedStep, step))))
      .returning({ userId: schema.userTotp.userId })
    return claimed ? 'totp' : null
  }
  if (!allowRecovery || !(await twoFactorEnabled(userId))) return null
  const [spent] = await db.update(schema.userRecoveryCodes).set({ usedAt: new Date() })
    .where(and(eq(schema.userRecoveryCodes.userId, userId), eq(schema.userRecoveryCodes.codeHash, hashRecoveryCode(given)),
      isNull(schema.userRecoveryCodes.usedAt)))
    .returning({ userId: schema.userRecoveryCodes.userId })
  return spent ? 'recovery' : null
}

/** Replaces the recovery codes with ten new ones and returns them (shown once; only hashes are kept). */
export async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes()
  await useAuthDb().transaction(async (tx) => {
    await tx.delete(schema.userRecoveryCodes).where(eq(schema.userRecoveryCodes.userId, userId))
    await tx.insert(schema.userRecoveryCodes).values(codes.map(c => ({ userId, codeHash: hashRecoveryCode(c) })))
  })
  return codes
}

export async function disableTwoFactor(userId: string) {
  await useAuthDb().transaction(async (tx) => {
    await tx.delete(schema.userRecoveryCodes).where(eq(schema.userRecoveryCodes.userId, userId))
    await tx.delete(schema.userTotp).where(eq(schema.userTotp.userId, userId))
  })
}
