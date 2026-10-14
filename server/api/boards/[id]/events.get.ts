import { sql } from 'drizzle-orm'

const COALESCE_MS = 250
const PING_MS = 25_000

const roleOf = (userId: string, session: SessionRef, boardId: string) =>
  withUser(userId, async tx => (await tx.execute<{ role: string | null }>(sql`select app.board_role(${boardId}) as role`))[0]?.role, '', session)

/**
 * Server-sent events: `change` whenever someone else changes the board (the
 * client then refetches it through RLS), `gone` when the user loses access.
 * Changes made by the tab given in ?client= are skipped.
 */
export default defineEventHandler(async (event) => {
  const { userId, session } = await requireSessionUser(event)
  const { id } = await paramsValidated(event, uuidParam)
  const client = clientIdOf(event)
  if (!await roleOf(userId, session, id)) notFound('Board not found')

  const stream = createEventStream(event)
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  // Bursts of changes become one event. Access is re-checked before each one.
  const flush = async () => {
    timer = undefined
    if (closed) return
    const role = await roleOf(userId, session, id).catch(() => null)
    if (closed) return
    if (!role) {
      await stream.push({ event: 'gone', data: '' })
      await stream.close()
      return
    }
    await stream.push({ event: 'change', data: '' })
  }

  const unsubscribe = await onBoardChange(id, (c) => {
    if (client && c === client) return
    timer ??= setTimeout(flush, COALESCE_MS)
  })
  const ping = setInterval(() => stream.push({ event: 'ping', data: '' }), PING_MS)

  stream.onClosed(() => {
    closed = true
    clearInterval(ping)
    clearTimeout(timer)
    unsubscribe()
  })
  return stream.send()
})
