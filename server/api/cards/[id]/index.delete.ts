import { sql } from 'drizzle-orm'

/** Moves the card (or template) to the board's trash; app.trash_card checks the caller can edit. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const [row] = await tx.execute<{ ok: boolean }>(sql`select app.trash_card(${id}) as ok`)
  if (!row?.ok) notFound('Card not found or not allowed')
  return { ok: true }
})
