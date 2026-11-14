import { eq } from 'drizzle-orm'
import type { BoardMatrixRoom } from '#shared/types/matrix'

export const matrixRoomColumns = {
  homeserverUrl: schema.boardMatrixRooms.homeserverUrl,
  roomId: schema.boardMatrixRooms.roomId,
  roomName: schema.boardMatrixRooms.roomName,
  botUserId: schema.boardMatrixRooms.botUserId,
}

/** The board's Matrix room as its members see it (board_matrix_rooms_select), or null. */
export async function loadMatrixRoom(tx: Tx, boardId: string): Promise<BoardMatrixRoom | null> {
  const [row] = await tx.select(matrixRoomColumns).from(schema.boardMatrixRooms).where(eq(schema.boardMatrixRooms.boardId, boardId))
  return row ?? null
}
