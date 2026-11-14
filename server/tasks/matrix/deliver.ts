/**
 * Matrix activity retries (scheduled every minute in nuxt.config.ts): posts
 * deliveries whose next attempt is due. New ones go out on NOTIFY (server/plugins/matrix.ts).
 */
export default defineTask({
  meta: { name: 'matrix:deliver', description: 'Post due card activity into Matrix threads' },
  async run() {
    await deliverMatrixActivity()
    return { result: 'ok' }
  },
})
