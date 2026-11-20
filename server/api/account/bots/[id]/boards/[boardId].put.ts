import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AccountBot } from '#shared/types/bots'

const params = z.object({ id: z.uuid(), boardId: z.uuid() })
const body = z.object({ role: z.enum(botRoles) })

/**
 * Adds the caller's account bot to a board or changes its role there
 * (app.add_account_bot_to_board: the bot's owner, on boards they own; never
 * as owner). Cookie only.
 */
export default defineUserHandler(async (event, tx): Promise<AccountBot> => {
  const { id, boardId } = await paramsValidated(event, params)
  const { role } = await readValidated(event, body)
  await tx.execute(sql`select app.add_account_bot_to_board(${id}, ${boardId}, ${role}::board_role)`)
  return loadManagedBot(tx, { board: null, team: null }, id) as Promise<AccountBot>
})
