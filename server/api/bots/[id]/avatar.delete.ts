import { sql } from 'drizzle-orm'
import type { BoardBot } from '#shared/types/bots'

/** Removes the bot's profile picture (app.clear_bot_avatar: owners of its board or team). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const scope = await botScope(tx, id)
  await tx.execute(sql`select app.clear_bot_avatar(${id})`)
  return (await loadScopeBots(tx, scope, true)).find(b => b.id === id)!
})
