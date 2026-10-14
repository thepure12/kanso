/**
 * Webhook retries (scheduled every minute in nuxt.config.ts): sends deliveries
 * whose next attempt is due. New ones go out on NOTIFY (server/plugins/webhooks.ts).
 */
export default defineTask({
  meta: { name: 'webhooks:deliver', description: 'Send due webhook deliveries' },
  async run() {
    await deliverWebhooks()
    return { result: 'ok' }
  },
})
