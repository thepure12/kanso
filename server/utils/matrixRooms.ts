import { and, eq, isNotNull } from 'drizzle-orm'
import type { BoardMatrixRoom, MatrixUserLink } from '#shared/types/matrix'

export const matrixRoomColumns = {
  homeserverUrl: schema.boardMatrixRooms.homeserverUrl,
  roomId: schema.boardMatrixRooms.roomId,
  roomName: schema.boardMatrixRooms.roomName,
  botUserId: schema.boardMatrixRooms.botUserId,
  postActivity: schema.boardMatrixRooms.postActivity,
  activityEvents: schema.boardMatrixRooms.activityEvents,
}

/** The board's Matrix room as its members see it (board_matrix_rooms_select), or null. */
export async function loadMatrixRoom(tx: Tx, boardId: string): Promise<BoardMatrixRoom | null> {
  const [row] = await tx.select(matrixRoomColumns).from(schema.boardMatrixRooms).where(eq(schema.boardMatrixRooms.boardId, boardId))
  return row ?? null
}

/** The caller's Matrix account on the board (pending or verified), or null. */
export async function loadMyMatrixLink(tx: Tx, boardId: string, userId: string): Promise<MatrixUserLink | null> {
  const u = schema.boardMatrixUsers
  const [row] = await tx.select({ mxid: u.mxid, verifiedAt: u.verifiedAt, code: u.code, codeExpiresAt: u.codeExpiresAt })
    .from(u).where(and(eq(u.boardId, boardId), eq(u.userId, userId)))
  if (!row) return null
  return { mxid: row.mxid, verified: !!row.verifiedAt, code: row.code, codeExpiresAt: row.codeExpiresAt?.toISOString() ?? null }
}

/** Verified Matrix accounts on the board: Matrix ID to Kanso user id. */
export async function loadBoardMatrixUsers(tx: Tx, boardId: string): Promise<Map<string, string>> {
  const u = schema.boardMatrixUsers
  const rows = await tx.select({ mxid: u.mxid, userId: u.userId }).from(u).where(and(eq(u.boardId, boardId), isNotNull(u.verifiedAt)))
  return new Map(rows.map(r => [r.mxid, r.userId]))
}
