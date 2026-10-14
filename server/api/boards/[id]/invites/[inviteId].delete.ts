import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const params = z.object({ id: z.uuid(), inviteId: z.uuid() })

export default defineUserHandler(async (event, tx) => {
  const { id, inviteId } = await paramsValidated(event, params)
  const { invites: i } = schema
  // RLS: only board owners revoke invites.
  const rows = await tx.delete(i).where(and(eq(i.id, inviteId), eq(i.boardId, id))).returning({ id: i.id })
  if (!rows.length) notFound('Invite not found or not allowed')
  return { ok: true }
})
