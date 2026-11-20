import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardBot } from '#shared/types/bots'

const body = z.object({ name: botNameSchema.optional(), role: z.enum(botRoles).optional() })

/** Renames a bot or changes its role (app.update_board_bot / app.update_team_bot: owners of its board or team). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  const scope = await botScope(tx, id)
  const current = (await loadScopeBots(tx, scope, false)).find(b => b.id === id)
  if (!current) notFound('Bot not found')
  const name = patch.name ?? current.name
  const role = patch.role ?? current.role
  await tx.execute(scope.board !== null
    ? sql`select app.update_board_bot(${id}, ${name}, ${role}::board_role)`
    : sql`select app.update_team_bot(${id}, ${name}, ${role}::board_role)`)
  return (await loadScopeBots(tx, scope, true)).find(b => b.id === id)!
})
