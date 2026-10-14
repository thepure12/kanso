import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const params = z.object({ id: z.uuid(), userId: z.uuid() })

export default defineUserHandler(async (event, tx) => {
  const { id, userId } = await paramsValidated(event, params)
  const { teamMembers: m } = schema
  // RLS: owners remove anyone, members remove themselves (leave).
  const rows = await tx.delete(m).where(and(eq(m.teamId, id), eq(m.userId, userId))).returning({ userId: m.userId })
  if (!rows.length) notFound('Member not found or not allowed')
  return { ok: true }
})
