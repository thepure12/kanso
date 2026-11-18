import { sql } from 'drizzle-orm'

/**
 * Personal card reminders (every minute, nuxt.config.ts). app.run_card_reminders
 * locks each due reminder (SKIP LOCKED) and marks or deletes it in the same
 * transaction, so reruns and several instances send nothing twice.
 */
export default defineTask({
  meta: { name: 'cards:reminders', description: 'Send due card reminders' },
  async run() {
    const rows = await useAuthDb().execute<{ reminder_id: string }>(sql`select * from app.run_card_reminders()`)
    return { result: { sent: rows.length } }
  },
})
