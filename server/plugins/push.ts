// Sends push messages as soon as they are queued (NOTIFY push_messages at
// commit), and whatever is already queued at startup. Messages a crashed run
// left behind come from the push:deliver task.
export default defineNitroPlugin(() => {
  const run = () => deliverPush().catch(err => console.error('Push delivery failed:', err))
  onPushQueued(run).then(run).catch(err => console.error('Could not listen for push messages:', err))
})
