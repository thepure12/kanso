import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardMatrixRoom } from '#shared/types/matrix'

const body = z.object({
  homeserver: z.string().trim().min(1).max(300),
  room: z.string().trim().min(1).max(300),
  /** Omitted: keep the stored token (changing the room or homeserver only). */
  accessToken: z.string().trim().min(1).max(2000).optional(),
})

/**
 * Connects the board to a Matrix room through a bot account, or changes the
 * connection (board_matrix_rooms policies: effective owners). The row is
 * written first, so non-owners are refused before any request leaves the
 * server; then the homeserver is asked (token, room membership, no
 * encryption) and the checked values replace the typed ones. Any failure
 * rolls the write back.
 */
export default defineUserHandler(async (event, tx, userId): Promise<BoardMatrixRoom> => {
  const { id } = await paramsValidated(event, uuidParam)
  const input = await readValidated(event, body)
  const room = parseRoomInput(input.room)
  if (!room) throw createError({ statusCode: 400, statusMessage: 'room: Enter a room ID (!…:server), an alias (#…:server) or a matrix.to link' })

  const [stored] = await tx.execute<{ access_token: string }>(sql`select access_token from app.matrix_room_credentials(${id})`)
  const m = schema.boardMatrixRooms
  await tx.insert(m)
    .values({ boardId: id, homeserverUrl: 'https://pending', roomId: room, botUserId: '', accessToken: '', createdBy: userId })
    .onConflictDoUpdate({ target: m.boardId, set: { updatedAt: sql`now()` } })

  let accessToken = input.accessToken
  if (!accessToken) {
    accessToken = (stored && openMatrixToken(stored.access_token)) ?? undefined
    if (!accessToken) throw createError({ statusCode: 400, statusMessage: 'accessToken: Required' })
  }
  let info: MatrixRoomInfo
  try {
    const homeserverUrl = await resolveHomeserver(input.homeserver)
    info = await checkMatrixRoom({ homeserverUrl, accessToken }, room)
  }
  catch (e) {
    matrixHttpError(e)
  }
  await tx.update(m)
    .set({ ...info, accessToken: sealMatrixToken(accessToken), updatedAt: sql`now()` })
    .where(sql`${m.boardId} = ${id}`)
  return (await loadMatrixRoom(tx, id))!
})
