import { eq } from 'drizzle-orm'

/** Disconnects the board from its Matrix room (board_matrix_rooms_delete: owners). Nothing is sent to Matrix. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const rows = await tx.delete(schema.boardMatrixRooms).where(eq(schema.boardMatrixRooms.boardId, id))
    .returning({ boardId: schema.boardMatrixRooms.boardId })
  if (!rows.length) notFound('No Matrix room connected')
  return { ok: true }
})
