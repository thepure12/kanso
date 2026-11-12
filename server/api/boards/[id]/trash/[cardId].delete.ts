import { sql } from 'drizzle-orm'
import { z } from 'zod'

const params = z.object({ id: z.uuid(), cardId: z.uuid() })

/** Deletes one trashed card of the board for good. Editors only (app.purge_trashed_card). */
export default defineUserHandler(async (event, tx) => {
  const { id, cardId } = await paramsValidated(event, params)
  const [row] = await tx.execute<{ ok: boolean }>(
    sql`select app.purge_trashed_card(${id}, ${cardId}) as ok`)
  if (!row?.ok) notFound('Card not in the trash or not allowed')
  return { ok: true }
})
