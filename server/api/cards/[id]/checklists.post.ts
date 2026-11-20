import { z } from 'zod'
import type { Checklist } from '#shared/types/board'

const body = z.object({ name: checklistName })

/** Adds an empty named checklist at the end of the card's checklists. */
export default defineUserHandler(async (event, tx): Promise<Checklist> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name } = await readValidated(event, body)
  const boardId = await cardBoardId(tx, id)
  const { checklists: cl } = schema
  const [row] = await tx.insert(cl).values({ cardId: id, boardId, name, position: await endPosition(tx, 'checklist', id) })
    .returning(checklistColumns())
  return { ...row!, items: [] }
})
