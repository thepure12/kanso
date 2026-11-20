import type { BoardBot } from '#shared/types/bots'

/** The team's bots (team members); owners also get each bot's tokens (app.bot_tokens). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertTeamVisible(tx, id)
  return loadTeamBots(tx, id, await isTeamOwner(tx, id))
})
