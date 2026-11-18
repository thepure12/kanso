import { sql } from 'drizzle-orm'

/**
 * Time-based board automations and scheduled card actions (hourly, nuxt.config.ts).
 * app.run_board_automations only changes cards not yet in the target state and
 * locks each automation while it runs; app.run_scheduled_card_actions deletes
 * each action it runs; app.wake_snoozed_cards clears each date it reaches. So reruns and several instances do nothing twice.
 */
export default defineTask({
  meta: { name: 'cards:automations', description: 'Run time-based board automations' },
  async run() {
    const db = useAuthDb()
    const rows = await db.execute<{ automation_id: string, card_id: string }>(sql`select * from app.run_board_automations()`)
    const scheduled = await db.execute<{ action_id: string }>(sql`select * from app.run_scheduled_card_actions()`)
    const woken = await db.execute<{ card_id: string }>(sql`select * from app.wake_snoozed_cards()`)
    return { result: { changed: rows.length, scheduled: scheduled.length, woken: woken.length } }
  },
})
