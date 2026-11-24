import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { priorities, type Priority } from '#shared/types/board'
import { myWorkPeople } from '#shared/myWork'
import type { MyChecklistItem, MyWork, MyWorkPerson } from '#shared/types/myWork'

const LIMIT = 500

/** A query value given once or repeated (`?tag=a&tag=b`). */
const list = <T extends z.ZodType>(item: T) =>
  z.preprocess(v => v === undefined ? [] : Array.isArray(v) ? v : [v], z.array(item).max(100))

const query = z.object({
  people: z.enum(myWorkPeople).default('involved'),
  user: list(z.uuid()),
  column: list(z.string().min(1).max(200)),
  board: list(z.uuid()),
  tag: list(z.string().min(1).max(200)),
  priority: list(z.enum([...priorities, 'none'])),
})

// Cards across every board the caller can see, by default the ones they are
// assigned to, watch or have open checklist items on (My work). The query
// narrows it for My work panels (shared/myWork.ts): whose cards, column titles
// and card tag names (case-insensitive, any board), boards, priority.
// Plain SELECTs: RLS limits the cards to boards the caller can see. Templates,
// archived and snoozed cards and archived boards are left out (as in due soon and the digest).
export default defineUserHandler(async (event, tx, userId): Promise<MyWork> => {
  const q = await getValidatedQuery(event, v => query.parse(v))
  const { cards, boards, columns, cardAssignees: ca, cardWatchers: cw, checklistItems: ci, cardTags: ct, tags, users } = schema
  const assigned = sql<boolean>`exists (select 1 from ${ca} where ${ca.cardId} = ${cards.id} and ${ca.userId} = ${userId})`
  const watching = sql<boolean>`exists (select 1 from ${cw} where ${cw.cardId} = ${cards.id} and ${cw.userId} = ${userId})`
  // Open checklist items assigned to the caller, in checklist order.
  const items = sql<MyChecklistItem[]>`coalesce((select json_agg(json_build_object('id', ${ci.id}, 'text', ${ci.text}, 'dueDate', ${ci.dueDate}) order by ${ci.position})
    from ${ci} where ${ci.cardId} = ${cards.id} and ${ci.assigneeId} = ${userId} and not ${ci.done}), '[]')`
  const hasItems = sql<boolean>`exists (select 1 from ${ci} where ${ci.cardId} = ${cards.id} and ${ci.assigneeId} = ${userId} and not ${ci.done})`
  // Marked complete, or in the board's last column.
  const done = sql<boolean>`${cards.completedAt} is not null or not exists (select 1 from ${columns} c2 where c2.board_id = ${cards.boardId} and c2.position > ${columns.position})`
  // Assignees the caller can see (users policies), by name.
  const assignees = sql<MyWorkPerson[]>`coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name, 'avatarUrl', u.avatar_url) order by u.name)
    from ${ca} join ${users} u on u.id = ${ca.userId} where ${ca.cardId} = ${cards.id}), '[]')`

  const where: (SQL | undefined)[] = [
    isNull(cards.archivedAt), isNull(cards.snoozedUntil), eq(cards.isTemplate, false), isNull(boards.archivedAt),
  ]
  switch (q.people) {
    case 'involved': where.push(sql`(${assigned} or ${watching} or ${hasItems})`); break
    case 'assigned': where.push(sql`(${assigned} or ${hasItems})`); break
    case 'watching': where.push(watching); break
    case 'people': where.push(q.user.length
      ? sql`exists (select 1 from ${ca} where ${ca.cardId} = ${cards.id} and ${ca.userId} in ${q.user})`
      : sql`false`); break
    case 'anyone': break
  }
  if (q.column.length) where.push(sql`lower(${columns.title}) in ${q.column.map(c => c.trim().toLowerCase())}`)
  if (q.board.length) where.push(sql`${cards.boardId} in ${q.board}`)
  if (q.tag.length) {
    where.push(sql`exists (select 1 from ${ct} join ${tags} on ${tags.id} = ${ct.tagId}
      where ${ct.cardId} = ${cards.id} and lower(${tags.name}) in ${q.tag.map(t => t.trim().toLowerCase())})`)
  }
  if (q.priority.length) {
    const set = q.priority.filter(p => p !== 'none')
    where.push(sql`(${set.length ? sql`${cards.priority} in ${set}` : sql`false`}${q.priority.includes('none') ? sql` or ${cards.priority} is null` : sql``})`)
  }

  const rows = await tx.select({
    id: cards.id, title: cards.title, boardId: cards.boardId, boardName: boards.name, columnId: cards.columnId, columnTitle: columns.title,
    startDate: cards.startDate, dueDate: cards.dueDate, priority: cards.priority, estimate: cards.estimate,
    assigned, watching, done, checklistItems: items, assignees,
  }).from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .where(and(...where))
    .orderBy(sql`${cards.dueDate} asc nulls last`, sql`${cards.priority} desc nulls last`, asc(boards.name), asc(columns.position), asc(cards.position))
    .limit(LIMIT)

  return { cards: rows.map(r => ({ ...r, priority: r.priority as Priority | null })) }
})
