import { sql } from 'drizzle-orm'

/** Deletes cards that have been in a board's trash for more than 30 days (daily, nuxt.config.ts). */
export default defineTask({
  meta: { name: 'cards:trash', description: 'Purge cards trashed more than 30 days ago' },
  async run() {
    const [row] = await useAuthDb().execute<{ n: number }>(sql`select app.purge_trash() as n`)
    return { result: { purged: row?.n ?? 0 } }
  },
})
