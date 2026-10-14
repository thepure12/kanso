import { sql } from 'drizzle-orm'
import type { InstanceSettings } from '#shared/types/admin'

export const settingsColumns = {
  signupMode: schema.instanceSettings.signupMode,
  allowedDomains: schema.instanceSettings.allowedDomains,
  allowedEmails: schema.instanceSettings.allowedEmails,
  allowExternalInvites: schema.instanceSettings.allowExternalInvites,
}

/** RLS returns the settings row to admins only. */
export function settingsOrForbidden(row: InstanceSettings | undefined): InstanceSettings {
  if (!row) throw createError({ statusCode: 403, statusMessage: 'Only admins can do that' })
  return row
}

/** app.is_admin() for the transaction's user. */
export async function isAdmin(tx: Tx): Promise<boolean> {
  const [row] = await tx.execute<{ is_admin: boolean }>(sql`select app.is_admin() as is_admin`)
  return !!row?.is_admin
}
