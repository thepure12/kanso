import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AccountBot, BoardBot } from '#shared/types/bots'

const body = z.object({ name: botNameSchema.optional(), role: z.enum(botRoles).optional() })

/**
 * Renames a bot or changes its role (app.update_board_bot / app.update_team_bot:
 * owners of its board or team). Account bots (app.rename_account_bot: their
 * owner) only take a name; their role is per board. Cookie only.
 */
export default defineUserHandler(async (event, tx): Promise<BoardBot | AccountBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const patch = await readValidated(event, body)
  const scope = await botScope(tx, id)
  if (isAccountScope(scope)) {
    if (patch.role) throw createError({ statusCode: 400, statusMessage: 'role: An account bot has a role per board' })
    if (patch.name) await tx.execute(sql`select app.rename_account_bot(${id}, ${patch.name})`)
    return loadManagedBot(tx, scope, id)
  }
  const current = (await loadScopeBots(tx, scope, false)).find(b => b.id === id)
  if (!current) notFound('Bot not found')
  const name = patch.name ?? current.name
  const role = patch.role ?? current.role
  await tx.execute(scope.board !== null
    ? sql`select app.update_board_bot(${id}, ${name}, ${role}::board_role)`
    : sql`select app.update_team_bot(${id}, ${name}, ${role}::board_role)`)
  return loadManagedBot(tx, scope, id)
})
