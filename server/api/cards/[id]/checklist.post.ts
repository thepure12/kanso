import { z } from 'zod'
import type { ChecklistItem } from '#shared/types/board'

const body = z.object({ text: z.string().trim().min(1).max(500) })

export default defineUserHandler(async (event, tx): Promise<ChecklistItem> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { text } = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { checklistItems: ci } = schema
  const [item] = await tx.insert(ci).values({ cardId: id, boardId, text, position: await endPosition(tx, 'checklist', id) })
    .returning({ id: ci.id, text: ci.text, done: ci.done, position: ci.position })
  return item!
})
