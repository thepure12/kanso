import { sql } from 'drizzle-orm'

/** Brings a trashed card back to its column, at its old position. Editors, via app.restore_card. */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  const [row] = await tx.execute<{ ok: boolean }>(sql`select app.restore_card(${id}) as ok`)
  if (!row?.ok) notFound('Card not in the trash or not allowed')
  return { ok: true }
})
