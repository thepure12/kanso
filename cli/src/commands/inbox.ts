import type { MyWork } from '../../../shared/types/myWork.ts'
import type { Inbox } from '../../../shared/types/notifications.ts'
import type { SearchResults } from '../../../shared/types/search.ts'
import { UsageError } from '../io.ts'
import { json, table } from '../output.ts'
import { isUuid, pick } from '../resolve.ts'
import { connect, formatTime, positionals, shortId, stringOption } from './common.ts'
import type { Command } from './types.ts'

export const myWork: Command = {
  name: 'my-work',
  summary: 'Cards on every board assigned to you or watched by you, soonest due first',
  usage: 'my-work [--done]',
  options: {
    done: { type: 'boolean', description: 'Include cards in their board\'s last (done) column' },
  },
  async run(ctx) {
    positionals(ctx)
    const { cards: all } = await (await connect(ctx)).get<MyWork>('/api/my-work')
    const cards = all.filter(c => ctx.values.done || !c.done)
    if (ctx.json) {
      ctx.io.stdout(json(cards))
      return
    }
    ctx.io.stdout(cards.length
      ? table(['ID', 'DUE', 'PRIORITY', 'TITLE', 'BOARD', 'COLUMN', 'WHY'], cards.map(c => [
          shortId(c.id), c.dueDate, c.priority, c.title, c.boardName, c.columnTitle,
          [c.assigned && 'assigned', c.watching && 'watching', c.checklistItems.length && 'checklist'].filter(Boolean).join(', '),
        ]))
      : 'Nothing assigned to you or watched by you.\n')
  },
}

export const notificationsLs: Command = {
  name: 'notifications ls',
  summary: 'Your notifications, newest first, and cards due by tomorrow',
  usage: 'notifications ls [--unread] [--limit <n>]',
  options: {
    unread: { type: 'boolean', description: 'Only unread ones' },
    limit: { type: 'string', value: '<n>', description: 'How many (1-100, default 50)' },
  },
  async run(ctx) {
    positionals(ctx)
    const limit = stringOption(ctx, 'limit')
    if (limit !== undefined && !/^\d+$/.test(limit)) throw new UsageError('--limit must be a number from 1 to 100.')
    const query = new URLSearchParams({ ...(ctx.values.unread && { unread: '1' }), ...(limit && { limit }) })
    const inbox = await (await connect(ctx)).get<Inbox>(`/api/notifications${query.size ? `?${query}` : ''}`)
    const items = inbox.items.map(n => ({
      id: n.id,
      read: n.readAt !== null,
      kind: n.activity.kind,
      actor: n.activity.actorName,
      data: n.activity.data,
      at: n.activity.createdAt,
      boardId: n.boardId,
      board: n.boardName,
      cardId: n.cardId,
      card: n.cardTitle,
    }))
    if (ctx.json) {
      ctx.io.stdout(json({ unread: inbox.unread, items, dueSoon: inbox.dueSoon }))
      return
    }
    ctx.io.stdout(`${inbox.unread} unread.\n`)
    if (items.length) {
      ctx.io.stdout(table(['ID', 'NEW', 'WHEN', 'WHAT', 'BY', 'CARD', 'BOARD'],
        items.map(n => [shortId(n.id), n.read ? '' : '*', formatTime(n.at), n.kind, n.actor, n.card, n.board])))
    }
    if (inbox.dueSoon.length) {
      ctx.io.stdout(`\nDue soon:\n${table(['DUE', 'CARD', 'BOARD'], inbox.dueSoon.map(d => [d.dueDate, d.item ? `${d.cardTitle} › ${d.item}` : d.cardTitle, d.boardName]))}`)
    }
  },
}

export const notificationsRead: Command = {
  name: 'notifications read',
  summary: 'Mark notifications read (by id, or all with --all)',
  usage: 'notifications read <id>... | --all',
  options: {
    all: { type: 'boolean', description: 'Mark every notification read' },
  },
  details: 'An id may be shortened to its first 8 characters, as listed by "kanso notifications ls".',
  async run(ctx) {
    const client = await connect(ctx)
    if (ctx.values.all) {
      if (ctx.positionals.length) throw new UsageError('Give ids or --all, not both.')
      await client.post('/api/notifications/read-all')
      ctx.io.stdout(ctx.json ? json({ all: true }) : 'Marked all notifications read.\n')
      return
    }
    if (!ctx.positionals.length) throw new UsageError('Missing <id> (or --all).')
    let listed: Inbox['items'] | undefined
    const ids: string[] = []
    for (const ref of ctx.positionals) {
      if (isUuid(ref)) {
        ids.push(ref)
        continue
      }
      listed ??= (await client.get<Inbox>('/api/notifications?limit=100')).items
      ids.push(pick('notification', ref, listed, n => n.id, n => [`${n.activity.kind}: ${n.cardTitle}`]).id)
    }
    for (const id of ids) await client.patch(`/api/notifications/${id}`, { read: true })
    ctx.io.stdout(ctx.json ? json({ ids }) : `Marked ${ids.length} notification${ids.length === 1 ? '' : 's'} read.\n`)
  },
}

export const search: Command = {
  name: 'search',
  summary: 'Search card titles, descriptions, comments, boards and columns',
  usage: 'search <query> [--archived]',
  options: {
    archived: { type: 'boolean', description: 'Include archived cards and boards' },
  },
  details: 'Words match by prefix. Several words (or a quoted query) must all match.',
  async run(ctx) {
    const q = ctx.positionals.join(' ').trim()
    if (!q) throw new UsageError('Missing <query>.')
    const query = new URLSearchParams({ q, ...(ctx.values.archived && { archived: '1' }) })
    const results = await (await connect(ctx)).get<SearchResults>(`/api/search?${query}`)
    if (ctx.json) {
      ctx.io.stdout(json(results))
      return
    }
    const { cards, boards, columns } = results
    if (!cards.length && !boards.length && !columns.length) {
      ctx.io.stdout('No matches.\n')
      return
    }
    const parts: string[] = []
    if (cards.length) parts.push(`Cards:\n${table(['ID', 'TITLE', 'BOARD', 'COLUMN', 'MATCH'], cards.map(c => [shortId(c.id), c.title, c.boardName, c.columnName, [c.inComment ? 'comment' : '', c.archived ? 'archived' : ''].filter(Boolean).join(', ')]))}`)
    if (boards.length) parts.push(`Boards:\n${table(['ID', 'NAME'], boards.map(b => [b.id, b.name]))}`)
    if (columns.length) parts.push(`Columns:\n${table(['ID', 'TITLE', 'BOARD'], columns.map(c => [c.id, c.title, c.boardName]))}`)
    ctx.io.stdout(parts.join('\n'))
  },
}
