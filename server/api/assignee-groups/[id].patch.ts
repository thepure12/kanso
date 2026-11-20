import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AssigneeGroup } from '#shared/types/board'

const body = z.object({
  name: assigneeGroupName.optional(),
  // Replaces the member set (only the differences are written).
  userIds: assigneeGroupUserIds.optional(),
})

export default defineUserHandler(async (event, tx): Promise<AssigneeGroup> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { assigneeGroups: g } = schema
  if (input.name === undefined && !input.userIds) throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })

  const [group] = await tx.select({ boardId: g.boardId }).from(g).where(eq(g.id, id))
  if (!group) notFound('Assignee group not found')

  // An update also for member-only changes, so viewers get 404 rather than a policy error.
  const rows = await tx.update(g).set({ name: input.name ?? sql`name` }).where(eq(g.id, id)).returning({ id: g.id })
  if (!rows.length) notFound('Assignee group not found or not allowed')
  if (input.userIds) await setAssigneeGroupMembers(tx, id, group.boardId, input.userIds)
  return (await loadAssigneeGroup(tx, id)) ?? notFound('Assignee group not found')
})
