// Sends webhook deliveries as soon as they are queued (NOTIFY board_webhooks
// at commit), and whatever is already due at startup. Retries come from the
// webhooks:deliver task.
export default defineNitroPlugin(() => {
  const run = () => deliverWebhooks().catch(err => console.error('Webhook delivery failed:', err))
  onWebhooksQueued(run).then(run).catch(err => console.error('Could not listen for webhooks:', err))
})
