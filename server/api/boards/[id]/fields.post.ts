import { z } from 'zod'
import { fieldKinds, type BoardField } from '#shared/types/board'

const body = z.object({
  name: fieldName,
  kind: z.enum(fieldKinds),
  options: fieldOptions.default([]),
  showOnCard: z.boolean().default(false),
})

/** Adds a custom field at the end of the board's fields. */
export default defineUserHandler(async (event, tx): Promise<BoardField> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { boardFields: f } = schema
  const [row] = await tx.insert(f).values({
    boardId: id,
    name: input.name,
    kind: input.kind,
    options: input.kind === 'select' ? input.options : [],
    showOnCard: input.showOnCard,
    position: await endPosition(tx, 'field', id),
  }).returning(boardFieldColumns)
  return toBoardField(row!)
})
