import type { BoardBot } from '#shared/types/bots'

/** The board's bots (people on the board); owners also get each bot's tokens (app.bot_tokens). Cookie only. */
export default defineUserHandler(async (event, tx): Promise<BoardBot[]> => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  return loadBots(tx, id, await isBoardOwner(tx, id))
})
