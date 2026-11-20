import { sql } from 'drizzle-orm'
import type { AccountBot, BoardBot } from '#shared/types/bots'

/** Removes the bot's profile picture (app.clear_bot_avatar: owners of its board or team, an account bot's owner). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot | AccountBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const scope = await botScope(tx, id)
  await tx.execute(sql`select app.clear_bot_avatar(${id})`)
  return loadManagedBot(tx, scope, id)
})
