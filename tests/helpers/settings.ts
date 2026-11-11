import type postgres from 'postgres'

/**
 * Turns on `allow_external_invites` (the default, but a dev database may have it
 * off) and returns a function that puts the old value back. Runs as the owner
 * role and drops the `settings.update` audit rows its own updates write, so the
 * admin audit log is left as it was.
 */
export async function allowExternalInvites(owner: postgres.Sql): Promise<() => Promise<void>> {
  const [row] = await owner`select allow_external_invites as allowed from instance_settings`
  if (row!.allowed) return async () => {}
  const set = (allowed: boolean) => owner.begin(sql => [
    sql`update instance_settings set allow_external_invites = ${allowed}`,
    // Audit rows of this transaction only (created_at defaults to now()).
    sql`delete from admin_audit_log where action = 'settings.update' and actor_id is null and created_at = now()`,
  ])
  await set(true)
  return () => set(false).then(() => {})
}
