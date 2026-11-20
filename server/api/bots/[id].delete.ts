import { sql } from 'drizzle-orm'

/**
 * Deletes a bot (app.delete_board_bot / app.delete_team_bot: owners of its
 * board or team; app.delete_account_bot: an account bot's owner). Its tokens
 * go with it; its cards, comments and activity stay with no author. Cookie only.
 */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const scope = await botScope(tx, id)
  await tx.execute(scope.board !== null
    ? sql`select app.delete_board_bot(${id})`
    : scope.team !== null ? sql`select app.delete_team_bot(${id})` : sql`select app.delete_account_bot(${id})`)
  return { ok: true }
})
