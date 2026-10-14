import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const params = z.object({ id: z.uuid(), userId: z.uuid() })
const body = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })

export default defineUserHandler(async (event, tx) => {
  const { id, userId } = await paramsValidated(event, params)
  const { role } = await readValidated(event, body)
  const { teamMembers: m } = schema
  const rows = await tx.update(m).set({ role })
    .where(and(eq(m.teamId, id), eq(m.userId, userId)))
    .returning({ userId: m.userId, role: m.role })
  return rows[0] ?? notFound('Member not found or you are not an owner')
})
