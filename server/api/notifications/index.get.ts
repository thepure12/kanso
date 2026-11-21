import { and, asc, count, eq, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Activity } from '#shared/types/board'
import type { Inbox } from '#shared/types/notifications'
import { notificationEvents, type NotificationEvent } from '#shared/notificationSettings'

const query = z.object({
  before: cursorParam.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  unread: z.enum(['0', '1']).optional(),
  boardId: z.uuid().optional(),
  event: z.enum(notificationEvents).optional(),
})

/** The activity kinds an event covers for its recipient, as notificationEvent sees them (app.notification_event in SQL). */
function eventFilter(event: NotificationEvent, userId: string) {
  const mentionsMe = sql`coalesce(a.data -> 'mentions', '[]'::jsonb) ? ${userId}::text`
  switch (event) {
    case 'mentioned': return sql`(a.kind = 'mentioned' or (a.kind = 'commented' and ${mentionsMe}))`
    case 'commented': return sql`(a.kind = 'commented' and not ${mentionsMe})`
    case 'assigned': return sql`a.kind in ('assigned', 'checklist_assigned')`
    case 'reminder': return sql`a.kind in ('reminder', 'woke')`
    default: return sql`a.kind = ${event}`
  }
}

interface Row extends Record<string, unknown> {
  id: string
  boardId: string
  boardName: string
  cardId: string
  cardTitle: string
  readAt: Date | string | null
  activityId: string
  actorId: string | null
  actorName: string | null
  kind: string
  data: unknown
  createdAt: Date | string
  ts: string
}

/**
 * The caller's notifications, newest first, keyset paginated and optionally
 * filtered (unread only, one board, one event), plus the overall unread count,
 * the boards they come from and the caller's cards due by tomorrow.
 */
export default defineUserHandler(async (event, tx, userId): Promise<Inbox> => {
  const q = await getValidatedQuery(event, v => query.parse(v))
  const { notifications: n, cards, boards, cardAssignees: ca, checklistItems: ci } = schema

  // RLS limits notifications to the caller's own, on boards they can still see.
  // Due soon leaves out archived boards (as the digest does).
  const open = and(isNull(cards.archivedAt), eq(cards.isTemplate, false), isNull(boards.archivedAt))
  const where = [
    q.before ? sql`(n.created_at, n.id) < (${q.before.ts}::timestamptz, ${q.before.id}::uuid)` : undefined,
    q.unread === '1' ? sql`n.read_at is null` : undefined,
    q.boardId ? sql`n.board_id = ${q.boardId}` : undefined,
    q.event ? eventFilter(q.event, userId) : undefined,
  ].filter(w => w !== undefined)

  const [rows, [unread], boardRows, dueCards, dueItems] = await Promise.all([
    tx.execute<Row>(sql`
      select n.id, n.board_id as "boardId", b.name as "boardName", n.card_id as "cardId", c.title as "cardTitle",
             n.read_at as "readAt", a.id as "activityId", a.actor_id as "actorId", u.name as "actorName",
             a.kind, a.data, a.created_at as "createdAt", n.created_at::text as ts
      from notifications n
      join card_activity a on a.id = n.activity_id
      join cards c on c.id = n.card_id
      join boards b on b.id = n.board_id
      left join users u on u.id = a.actor_id
      ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``}
      order by n.created_at desc, n.id desc
      limit ${q.limit + 1}
    `),
    tx.select({ n: count() }).from(n).where(isNull(n.readAt)),
    tx.execute<{ id: string, name: string, unread: number } & Record<string, unknown>>(sql`
      select b.id, b.name, count(*) filter (where n.read_at is null)::int as unread
      from notifications n join boards b on b.id = n.board_id
      group by b.id, b.name order by lower(b.name), b.id
    `),
    tx.select({ boardId: cards.boardId, boardName: boards.name, cardId: cards.id, cardTitle: cards.title, dueDate: cards.dueDate })
      .from(ca)
      .innerJoin(cards, eq(cards.id, ca.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(ca.userId, userId), open, lte(cards.dueDate, sql`current_date + 1`)))
      .orderBy(asc(cards.dueDate)),
    // Open checklist items assigned to the caller.
    tx.select({ boardId: cards.boardId, boardName: boards.name, cardId: cards.id, cardTitle: cards.title, dueDate: ci.dueDate, itemId: ci.id, item: ci.text })
      .from(ci)
      .innerJoin(cards, eq(cards.id, ci.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(ci.assigneeId, userId), eq(ci.done, false), open, lte(ci.dueDate, sql`current_date + 1`)))
      .orderBy(asc(ci.dueDate)),
  ])
  const dueSoon = [...dueCards, ...dueItems].sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
  const page = rows.slice(0, q.limit)
  const last = page.at(-1)
  const iso = (d: Date | string) => new Date(d).toISOString()

  return {
    items: page.map(i => ({
      id: i.id, boardId: i.boardId, boardName: i.boardName, cardId: i.cardId, cardTitle: i.cardTitle,
      readAt: i.readAt ? iso(i.readAt) : null,
      activity: {
        id: i.activityId, actorId: i.actorId, actorName: i.actorName,
        kind: i.kind as Activity['kind'], data: i.data as Activity['data'], createdAt: iso(i.createdAt),
      },
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last.id) : null,
    unread: unread?.n ?? 0,
    boards: boardRows.map(b => ({ id: b.id, name: b.name, unread: Number(b.unread) })),
    dueSoon: dueSoon.map(d => ({ ...d, dueDate: d.dueDate! })),
  }
})
