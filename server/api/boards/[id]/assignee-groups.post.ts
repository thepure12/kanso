import { z } from 'zod'
import type { AssigneeGroup } from '#shared/types/board'

const body = z.object({
  name: assigneeGroupName,
  userIds: assigneeGroupUserIds.default([]),
})

/** Adds an assignee group; members must have access to the board (else 403). */
export default defineUserHandler(async (event, tx): Promise<AssigneeGroup> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { assigneeGroups: g } = schema
  const [row] = await tx.insert(g).values({ boardId: id, name: input.name }).returning({ id: g.id })
  await setAssigneeGroupMembers(tx, row!.id, id, input.userIds)
  return (await loadAssigneeGroup(tx, row!.id))!
})
