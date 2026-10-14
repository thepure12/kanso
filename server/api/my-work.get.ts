import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Priority } from '#shared/types/board'
import type { MyWork } from '#shared/types/myWork'

const LIMIT = 500

// Plain SELECTs: RLS limits the cards to boards the caller can see. Templates,
// archived cards and archived boards are left out (as in due soon and the digest).
export default defineUserHandler(async (_event, tx, userId): Promise<MyWork> => {
  const { cards, boards, columns, cardAssignees: ca, cardWatchers: cw } = schema
  const assigned = sql<boolean>`exists (select 1 from ${ca} where ${ca.cardId} = ${cards.id} and ${ca.userId} = ${userId})`
  const watching = sql<boolean>`exists (select 1 from ${cw} where ${cw.cardId} = ${cards.id} and ${cw.userId} = ${userId})`
  const done = sql<boolean>`not exists (select 1 from ${columns} c2 where c2.board_id = ${cards.boardId} and c2.position > ${columns.position})`

  const rows = await tx.select({
    id: cards.id, title: cards.title, boardId: cards.boardId, boardName: boards.name, columnId: cards.columnId, columnTitle: columns.title,
    startDate: cards.startDate, dueDate: cards.dueDate, priority: cards.priority, estimate: cards.estimate,
    assigned, watching, done,
  }).from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .where(and(isNull(cards.archivedAt), eq(cards.isTemplate, false), isNull(boards.archivedAt), sql`(${assigned} or ${watching})`))
    .orderBy(sql`${cards.dueDate} asc nulls last`, sql`${cards.priority} desc nulls last`, asc(boards.name), asc(columns.position), asc(cards.position))
    .limit(LIMIT)

  return { cards: rows.map(r => ({ ...r, priority: r.priority as Priority | null })) }
})
