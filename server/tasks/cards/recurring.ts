import { sql } from 'drizzle-orm'

/**
 * Recurring cards (scheduled every 15 minutes in nuxt.config.ts).
 * app.run_due_recurrences claims due schedules, creates their cards and
 * advances them in one statement, so reruns and several instances create
 * nothing twice.
 */
export default defineTask({
  meta: { name: 'cards:recurring', description: 'Create cards from due recurring schedules' },
  async run() {
    const rows = await useAuthDb().execute<{ recurrence_id: string, card_id: string }>(sql`select * from app.run_due_recurrences()`)
    return { result: { created: rows.length } }
  },
})
