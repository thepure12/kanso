import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const params = z.object({ id: z.uuid(), userId: z.uuid() })

// Lifts a member's limits (owners only, enforced by RLS).
export default defineUserHandler(async (event, tx) => {
  const { id, userId } = await paramsValidated(event, params)
  const { boardMemberLimits: l } = schema
  const rows = await tx.delete(l).where(and(eq(l.boardId, id), eq(l.userId, userId))).returning({ userId: l.userId })
  if (!rows.length) notFound('No limits for this member, or you are not an owner')
  setResponseStatus(event, 204)
  return null
})
