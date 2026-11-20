import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AccountBot } from '#shared/types/bots'

const params = z.object({ id: z.uuid(), boardId: z.uuid() })

/**
 * Takes the caller's account bot off a board (app.remove_account_bot_from_board:
 * the bot's owner, also boards they no longer see). Board owners remove it
 * through DELETE /api/boards/:id/members/:userId like anyone. Cookie only.
 */
export default defineUserHandler(async (event, tx): Promise<AccountBot> => {
  const { id, boardId } = await paramsValidated(event, params)
  await tx.execute(sql`select app.remove_account_bot_from_board(${id}, ${boardId})`)
  return loadManagedBot(tx, { board: null, team: null }, id) as Promise<AccountBot>
})
