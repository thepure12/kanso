import { sql } from 'drizzle-orm'
import type { BoardMatrixRoom } from '#shared/types/matrix'

/**
 * Checks the stored connection again (app.matrix_room_credentials: owners
 * only): token, room membership, no encryption. Updates the room name and bot
 * id when they changed. Matrix problems are a 400 naming the error.
 */
export default defineUserHandler(async (event, tx): Promise<BoardMatrixRoom> => {
  const { id } = await paramsValidated(event, uuidParam)
  const [c] = await tx.execute<{ homeserver_url: string, room_id: string, access_token: string }>(
    sql`select * from app.matrix_room_credentials(${id})`)
  if (!c) notFound('No Matrix room connected')
  const accessToken = openMatrixToken(c.access_token)
  if (!accessToken) throw createError({ statusCode: 400, statusMessage: 'Matrix: the stored token cannot be read any more. Enter it again.' })
  let info: BoardMatrixRoom
  try {
    info = await checkMatrixRoom({ homeserverUrl: c.homeserver_url, accessToken }, c.room_id)
  }
  catch (e) {
    matrixHttpError(e)
  }
  const m = schema.boardMatrixRooms
  await tx.update(m).set({ roomName: info.roomName, botUserId: info.botUserId, updatedAt: sql`now()` })
    .where(sql`${m.boardId} = ${id} and (${m.roomName} is distinct from ${info.roomName} or ${m.botUserId} <> ${info.botUserId})`)
  return info
})
