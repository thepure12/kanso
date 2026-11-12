import { sql } from 'drizzle-orm'

/** Empties the board's trash for good. Editors only (app.empty_trash). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  await assertBoardVisible(tx, id)
  const [row] = await tx.execute<{ n: number }>(sql`select app.empty_trash(${id}) as n`)
  return { deleted: row?.n ?? 0 }
})
