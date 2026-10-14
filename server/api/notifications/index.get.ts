import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import type { Activity } from '#shared/types/board'
import type { Inbox } from '#shared/types/notifications'

const LIMIT = 50

export default defineUserHandler(async (_event, tx, userId): Promise<Inbox> => {
  const { notifications: n, cardActivity: act, cards, boards, users, cardAssignees: ca } = schema

  // RLS limits notifications to the caller's own, on boards they can still see.
  // Due soon leaves out archived boards (as the digest does).
  const [items, [unread], dueSoon] = await Promise.all([
    tx.select({
      id: n.id, boardId: n.boardId, boardName: boards.name, cardId: n.cardId, cardTitle: cards.title, readAt: n.readAt,
      activityId: act.id, actorId: act.actorId, actorName: users.name, kind: act.kind, data: act.data, createdAt: act.createdAt,
    }).from(n)
      .innerJoin(act, eq(act.id, n.activityId))
      .innerJoin(cards, eq(cards.id, n.cardId))
      .innerJoin(boards, eq(boards.id, n.boardId))
      .leftJoin(users, eq(users.id, act.actorId))
      .orderBy(desc(n.createdAt)).limit(LIMIT),
    tx.select({ n: count() }).from(n).where(isNull(n.readAt)),
    tx.select({ boardId: cards.boardId, boardName: boards.name, cardId: cards.id, cardTitle: cards.title, dueDate: cards.dueDate })
      .from(ca)
      .innerJoin(cards, eq(cards.id, ca.cardId))
      .innerJoin(boards, eq(boards.id, cards.boardId))
      .where(and(eq(ca.userId, userId), isNull(cards.archivedAt), eq(cards.isTemplate, false), isNull(boards.archivedAt), lte(cards.dueDate, sql`current_date + 1`)))
      .orderBy(asc(cards.dueDate)),
  ])

  return {
    items: items.map(i => ({
      id: i.id, boardId: i.boardId, boardName: i.boardName, cardId: i.cardId, cardTitle: i.cardTitle,
      readAt: i.readAt?.toISOString() ?? null,
      activity: {
        id: i.activityId, actorId: i.actorId, actorName: i.actorName,
        kind: i.kind as Activity['kind'], data: i.data as Activity['data'], createdAt: i.createdAt.toISOString(),
      },
    })),
    unread: unread?.n ?? 0,
    dueSoon: dueSoon.map(d => ({ ...d, dueDate: d.dueDate! })),
  }
})
