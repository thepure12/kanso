import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardBot } from '#shared/types/bots'

const body = z.object({ name: botNameSchema, role: z.enum(botRoles).default('editor') })

/**
 * Adds a bot to the team (app.create_team_bot: team owners, never as owner).
 * It reaches every board of the team through its team role. Cookie only.
 */
export default defineUserHandler(async (event, tx): Promise<BoardBot> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { name, role } = await readValidated(event, body)
  await assertTeamVisible(tx, id)
  const [row] = await tx.execute<{ id: string }>(sql`select app.create_team_bot(${id}, ${name}, ${role}::board_role) as id`)
  return (await loadTeamBots(tx, id, true)).find(b => b.id === row!.id)!
})
