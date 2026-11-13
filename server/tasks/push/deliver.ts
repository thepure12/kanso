/**
 * Push retries (scheduled every minute in nuxt.config.ts): sends queued push
 * messages whose lease ran out. New ones go out on NOTIFY (server/plugins/push.ts).
 */
export default defineTask({
  meta: { name: 'push:deliver', description: 'Send queued push notifications' },
  async run() {
    await deliverPush()
    return { result: 'ok' }
  },
})
