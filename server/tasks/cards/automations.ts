import { sql } from 'drizzle-orm'

/**
 * Time-based board automations (hourly, nuxt.config.ts). app.run_board_automations
 * only changes cards not yet in the target state and locks each automation while
 * it runs, so reruns and several instances do nothing twice.
 */
export default defineTask({
  meta: { name: 'cards:automations', description: 'Run time-based board automations' },
  async run() {
    const rows = await useAuthDb().execute<{ automation_id: string, card_id: string }>(sql`select * from app.run_board_automations()`)
    return { result: { changed: rows.length } }
  },
})
