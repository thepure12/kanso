import { sql } from 'drizzle-orm'
import { z } from 'zod'

const body = z.object({ confirm: z.string() })

/**
 * Deletes the signed-in account (app.delete_my_account): personal boards and
 * teams it alone owns pass to another member or are deleted when empty. The
 * last admin cannot delete their account (409).
 */
export default defineUserHandler(async (event, tx) => {
  const { confirm } = await readValidated(event, body)
  const { user } = await requireUserSession(event)
  if (confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Type your email to confirm' })
  }
  await tx.execute(sql`select app.delete_my_account()`)
  clearSessionAfterCommit(event)
  return { ok: true }
})
