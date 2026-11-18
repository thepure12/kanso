import { z } from 'zod'
import type { MemberAccess } from '#shared/types/board'

const params = z.object({ id: z.uuid(), userId: z.uuid() })

// Limits a non-owner to columns and cards (owners only, enforced by RLS).
export default defineUserHandler(async (event, tx): Promise<MemberAccess> => {
  const { id, userId } = await paramsValidated(event, params)
  const access = await readValidated(event, memberAccessSchema)
  await setMemberAccess(tx, id, userId, access)
  return (await loadMemberAccess(tx, id))[userId] ?? notFound('Member not found')
})
