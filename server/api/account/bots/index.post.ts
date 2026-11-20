import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AccountBot } from '#shared/types/bots'

const body = z.object({ name: botNameSchema })

/** Makes a bot of the caller's own (app.create_account_bot: people only, at most 20, KB011 → 409). It starts on no board. Cookie only. */
export default defineUserHandler(async (event, tx): Promise<AccountBot> => {
  const { name } = await readValidated(event, body)
  const [row] = await tx.execute<{ id: string }>(sql`select app.create_account_bot(${name}) as id`)
  return loadManagedBot(tx, { board: null, team: null }, row!.id) as Promise<AccountBot>
})
