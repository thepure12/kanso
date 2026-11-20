import { sql } from 'drizzle-orm'
import type { BoardBot } from '#shared/types/bots'

/** Removes the bot's profile picture (app.clear_bot_avatar: owners of its board). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const board = await botBoard(tx, id)
  await tx.execute(sql`select app.clear_bot_avatar(${id})`)
  return (await loadBots(tx, board, true)).find(b => b.id === id)!
})
