import { sql } from 'drizzle-orm'
import { z } from 'zod'

/**
 * Sends a test message to this browser's subscription (endpoint), or to all of
 * the user's devices. Returns how many got it; dead subscriptions are dropped.
 */
export default defineUserHandler(async (event, tx) => {
  const { endpoint } = await readValidated(event, z.object({ endpoint: z.string().max(2000).optional() }))
  const targets = await tx.execute<PushTarget>(sql`select * from app.my_push_targets(${endpoint ?? null})`)
  if (!targets.length) notFound('Push is not turned on for this device')
  const userId = (await getUserSession(event)).user!.id
  const i18n = serverI18n(await recipientLocale(event, userId))
  const payload: PushPayload = {
    title: i18n.t('account.notifications.pushTestTitle'),
    body: i18n.t('account.notifications.pushTestBody'),
    tag: `kanso-push-test-${Date.now()}`,
    url: appPath('/account?tab=notifications'),
    force: true,
  }
  let sent = 0
  const auth = useAuthDb()
  for (const t of targets) {
    const res = await sendPush(t, payload)
    if (res.ok) sent++
    await auth.execute(sql`select app.record_push_result(${t.id}, ${res.ok}, ${res.gone})`)
  }
  return { sent, total: targets.length }
})
