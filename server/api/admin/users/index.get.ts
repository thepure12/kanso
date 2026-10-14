import { asc, eq } from 'drizzle-orm'
import type { AdminUser } from '#shared/types/admin'

/** Every account, for admins (users_select_admin). Others get 403. */
export default defineUserHandler(async (_event, tx): Promise<AdminUser[]> => {
  if (!(await isAdmin(tx))) throw createError({ statusCode: 403, statusMessage: 'Only admins can do that' })
  const u = schema.users
  const rows = await tx.select({
    id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl, createdAt: u.createdAt,
    verifiedAt: u.emailVerifiedAt, adminSince: schema.instanceAdmins.createdAt,
  }).from(u).leftJoin(schema.instanceAdmins, eq(schema.instanceAdmins.userId, u.id)).orderBy(asc(u.email))
  return rows.map(({ verifiedAt, adminSince, createdAt, ...r }) => ({
    ...r, createdAt: createdAt.toISOString(), verified: !!verifiedAt, isAdmin: !!adminSince,
  }))
})
