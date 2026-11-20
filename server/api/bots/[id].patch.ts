import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardBot } from '#shared/types/bots'

const body = z.object({ name: botNameSchema.optional(), role: z.enum(botRoles).optional() })

/** Renames a bot or changes its role (app.update_board_bot: owners of its board). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  const board = await botBoard(tx, id)
  const [current] = await tx.execute<{ name: string, role: string }>(sql`
    select u.name, m.role from users u join board_members m on m.board_id = u.bot_board_id and m.user_id = u.id
    where u.id = ${id}`)
  if (!current) notFound('Bot not found')
  await tx.execute(sql`select app.update_board_bot(${id}, ${patch.name ?? current.name}, ${patch.role ?? current.role}::board_role)`)
  return (await loadBots(tx, board, true)).find(b => b.id === id)!
})
