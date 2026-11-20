import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardBot } from '#shared/types/bots'

const body = z.object({ name: botNameSchema, role: z.enum(botRoles).default('editor') })

/** Adds a bot to the board (app.create_board_bot: effective owners, never as owner). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name, role } = await readValidated(event, body)
  await assertBoardVisible(tx, id)
  const [row] = await tx.execute<{ id: string }>(sql`select app.create_board_bot(${id}, ${name}, ${role}::board_role) as id`)
  const bot = (await loadBots(tx, id, true)).find(b => b.id === row!.id)
  return bot!
})
