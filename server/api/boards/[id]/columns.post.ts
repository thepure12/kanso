import { z } from 'zod'

const body = z.object({
  title: z.string().trim().min(1).max(100),
  // Also add the new column to this group (the one the board shows).
  groupId: z.uuid().optional(),
})

export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const { title, groupId } = await readValidated(event, body)
  const [col] = await tx.insert(schema.columns)
    .values({ boardId: id, title, position: await endPosition(tx, 'column', id) })
    .returning({ id: schema.columns.id, title: schema.columns.title, position: schema.columns.position, color: schema.columns.color, wipLimit: schema.columns.wipLimit, outline: schema.columns.outline })
  if (groupId) await tx.insert(schema.columnGroupMembers).values({ groupId, columnId: col!.id, boardId: id })
  return { ...col!, rules: [] }
})
