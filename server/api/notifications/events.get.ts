const COALESCE_MS = 250
const PING_MS = 25_000

/**
 * Server-sent events: `change` whenever the session user gets a notification
 * (the client then refetches GET /api/notifications through RLS).
 */
export default defineEventHandler(async (event) => {
  const userId = await requireLiveSession(event)
  const stream = createEventStream(event)
  let timer: ReturnType<typeof setTimeout> | undefined

  const unsubscribe = await onUserNotification(userId, () => {
    timer ??= setTimeout(() => {
      timer = undefined
      stream.push({ event: 'change', data: '' })
    }, COALESCE_MS)
  })
  const ping = setInterval(() => stream.push({ event: 'ping', data: '' }), PING_MS)

  stream.onClosed(() => {
    clearInterval(ping)
    clearTimeout(timer)
    unsubscribe()
  })
  return stream.send()
})
