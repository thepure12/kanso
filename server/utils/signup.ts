import { sql } from 'drizzle-orm'

/** True for the NUXT_ADMIN_EMAIL address (case-insensitive). */
export function isAdminEmail(email: string) {
  const admin = useRuntimeConfig().adminEmail.trim().toLowerCase()
  return !!admin && email.trim().toLowerCase() === admin
}

/**
 * Sign-up gate for new accounts (password or OAuth). The admin email always
 * passes, so a fresh install can be set up; everyone else is decided by
 * app.signup_allowed from the admin-edited instance_settings (mode, allowed
 * domains and emails, and whether invites admit other addresses).
 */
export async function assertSignupAllowed(email: string) {
  if (isAdminEmail(email)) return
  const [row] = await useAuthDb().execute<{ ok: boolean | null }>(sql`select app.signup_allowed(${email}) as ok`)
  if (row?.ok) return
  throw createError({ statusCode: 403, statusMessage: 'Sign-up is limited to approved or invited email addresses.' })
}

/** Makes the NUXT_ADMIN_EMAIL account an instance admin once its email is verified. */
export async function bootstrapAdmin(user: { id: string, email: string }) {
  if (!isAdminEmail(user.email)) return
  await useAuthDb().execute(sql`select app.bootstrap_admin(${user.id}, ${user.email})`)
}
