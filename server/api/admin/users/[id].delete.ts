import { sql } from 'drizzle-orm'

/** Removes an account (app.remove_user: admins only, not themselves). */
export default defineUserHandler(async (event, tx) => {
  const { id } = await paramsValidated(event, uuidParam)
  await tx.execute(sql`select app.remove_user(${id})`)
  return { ok: true }
})
