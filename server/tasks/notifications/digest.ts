import { sql } from 'drizzle-orm'
import type { Activity } from '#shared/types/board'
import { describeNotification } from '../../../app/utils/activityText'

type DigestRow = {
  user_id: string
  email: string
  name: string
  locale: string | null
  items: { boardId: string, boardName: string, cardId: string, cardTitle: string, actorName: string | null, kind: Activity['kind'], data: Activity['data'] }[]
  due: { boardId: string, boardName: string, cardId: string, cardTitle: string, dueDate: string }[]
}

/**
 * Daily email digest (scheduled in nuxt.config.ts). app.claim_digests marks
 * each opted-in user as sent for today and returns what to tell them, so
 * running it again the same day, or on several instances, sends nothing twice.
 */
export default defineTask({
  meta: { name: 'notifications:digest', description: 'Email the daily notification digest' },
  async run() {
    const rows = await useAuthDb().execute<DigestRow>(sql`select * from app.claim_digests()`)
    let failed = 0
    for (const r of rows) {
      try {
        const i18n = serverI18n(r.locale)
        await sendDigestEmail(i18n, r.email, r.name, r.items.map(i => ({
          ...i,
          text: `${i.actorName ?? i18n.t('common.someone')} ${describeNotification(i, i18n, r.user_id)}`,
        })), r.due)
      }
      catch (err) {
        failed++
        console.error(`[digest] Could not mail ${r.email}:`, err)
      }
    }
    return { result: { sent: rows.length - failed, failed } }
  },
})
