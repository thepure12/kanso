import { count, desc } from 'drizzle-orm'
import { z } from 'zod'
import type { AuditLogPage } from '#shared/types/admin'

const query = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) })
const PAGE_SIZE = 50

/** The admin audit log, newest first (admin_audit_log_select: admins only). Others get 403. */
export default defineUserHandler(async (event, tx): Promise<AuditLogPage> => {
  const { page } = await getValidatedQuery(event, q => query.parse(q))
  if (!(await isAdmin(tx))) throw createError({ statusCode: 403, statusMessage: 'Only admins can do that' })
  const a = schema.adminAuditLog
  const [rows, [total]] = await Promise.all([
    tx.select().from(a).orderBy(desc(a.createdAt), desc(a.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    tx.select({ n: count() }).from(a),
  ])
  return {
    total: total!.n,
    pageSize: PAGE_SIZE,
    entries: rows.map(r => ({
      id: r.id, action: r.action, actorId: r.actorId, targetUserId: r.targetUserId,
      data: r.data as Record<string, unknown>, createdAt: r.createdAt.toISOString(),
    })),
  }
})
