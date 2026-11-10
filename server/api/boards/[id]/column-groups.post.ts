import { z } from 'zod'
import type { ColumnGroup } from '#shared/types/board'

const body = z.object({
  name: columnGroupName,
  color: hexColor.nullable().default(null),
  columnIds: columnGroupColumnIds.default([]),
})

/** Adds a column group at the end of the board's groups. */
export default defineUserHandler(async (event, tx): Promise<ColumnGroup> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const { columnGroups: g } = schema
  const [row] = await tx.insert(g).values({
    boardId: id,
    name: input.name,
    color: input.color,
    position: await endPosition(tx, 'columnGroup', id),
  }).returning({ id: g.id })
  await setColumnGroupMembers(tx, row!.id, id, input.columnIds)
  return (await loadColumnGroup(tx, row!.id))!
})
