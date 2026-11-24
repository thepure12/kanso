import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Priority } from '#shared/types/board'
import type { MyChecklistItem, MyWork } from '#shared/types/myWork'

const LIMIT = 500

// Cards the caller is assigned to, watches or has open checklist items on.
// Plain SELECTs: RLS limits the cards to boards the caller can see. Templates,
// archived and snoozed cards and archived boards are left out (as in due soon and the digest).
export default defineUserHandler(async (_event, tx, userId): Promise<MyWork> => {
  const { cards, boards, columns, cardAssignees: ca, cardWatchers: cw, checklistItems: ci } = schema
  const assigned = sql<boolean>`exists (select 1 from ${ca} where ${ca.cardId} = ${cards.id} and ${ca.userId} = ${userId})`
  const watching = sql<boolean>`exists (select 1 from ${cw} where ${cw.cardId} = ${cards.id} and ${cw.userId} = ${userId})`
  // Open checklist items assigned to the caller, in checklist order.
  const items = sql<MyChecklistItem[]>`coalesce((select json_agg(json_build_object('id', ${ci.id}, 'text', ${ci.text}, 'dueDate', ${ci.dueDate}) order by ${ci.position})
    from ${ci} where ${ci.cardId} = ${cards.id} and ${ci.assigneeId} = ${userId} and not ${ci.done}), '[]')`
  const hasItems = sql<boolean>`exists (select 1 from ${ci} where ${ci.cardId} = ${cards.id} and ${ci.assigneeId} = ${userId} and not ${ci.done})`
  // Marked complete, or in the board's last column.
  const done = sql<boolean>`${cards.completedAt} is not null or not exists (select 1 from ${columns} c2 where c2.board_id = ${cards.boardId} and c2.position > ${columns.position})`

  const rows = await tx.select({
    id: cards.id, title: cards.title, boardId: cards.boardId, boardName: boards.name, columnId: cards.columnId, columnTitle: columns.title,
    startDate: cards.startDate, dueDate: cards.dueDate, priority: cards.priority, estimate: cards.estimate,
    assigned, watching, done, checklistItems: items,
  }).from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .where(and(isNull(cards.archivedAt), isNull(cards.snoozedUntil), eq(cards.isTemplate, false), isNull(boards.archivedAt), sql`(${assigned} or ${watching} or ${hasItems})`))
    .orderBy(sql`${cards.dueDate} asc nulls last`, sql`${cards.priority} desc nulls last`, asc(boards.name), asc(columns.position), asc(cards.position))
    .limit(LIMIT)

  return { cards: rows.map(r => ({ ...r, priority: r.priority as Priority | null })) }
})
