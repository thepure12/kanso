import { asc, eq, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Card, CardLink, TimeEntry } from '#shared/types/board'

/** A card's tag ids in board tag order (by name). */
export async function cardTagIds(tx: Tx, cardId: string): Promise<string[]> {
  const { cardTags, tags } = schema
  const rows = await tx.select({ tagId: cardTags.tagId }).from(cardTags)
    .innerJoin(tags, eq(tags.id, cardTags.tagId)).where(eq(cardTags.cardId, cardId)).orderBy(asc(tags.name))
  return rows.map(r => r.tagId)
}

type CardRow = Omit<Card, 'checklist' | 'createdAt' | 'completedAt'> & { checklistDone: number, checklistTotal: number, createdAt: Date | string, completedAt: Date | string | null }

/**
 * Cards matching `where` (a condition on alias c), in position order, with tags, assignees, field values and counts.
 * Each child table is read once for all matched cards and grouped by card (not one subquery per card), so its
 * select policy runs once per query rather than once per card.
 */
export async function loadCards(tx: Tx, where: SQL): Promise<Card[]> {
  const rows = await tx.execute<CardRow & Record<string, unknown>>(sql`
    with c as materialized (
      select c.id, c.column_id, c.title, c.description, c.position, c.start_date, c.due_date, c.priority,
             c.estimate, c.cover_attachment_id, c.skip_automations, c.stickers, c.completed_at,
             c.created_by, c.created_at
      from cards c
      where ${where}
    ),
    tg as (select ct.card_id, array_agg(ct.tag_id::text order by t.name) as ids
           from card_tags ct join tags t on t.id = ct.tag_id
           where ct.card_id in (select id from c) group by ct.card_id),
    asg as (select card_id, array_agg(user_id::text order by user_id) as ids
            from card_assignees where card_id in (select id from c) group by card_id),
    ci as (select card_id, count(*) filter (where done)::int as done, count(*)::int as total
           from checklist_items where card_id in (select id from c) group by card_id),
    cm as (select card_id, count(*)::int as n from card_comments where card_id in (select id from c) group by card_id),
    att as (select card_id, count(*)::int as n from card_attachments where card_id in (select id from c) group by card_id),
    te as (select card_id, sum(minutes)::int as n from time_entries where card_id in (select id from c) group by card_id),
    w as (select card_id from card_watchers where user_id = app.current_user_id() and card_id in (select id from c)),
    bl as (select to_card_id as card_id, array_agg(from_card_id::text order by from_card_id) as ids
           from card_links where kind = 'blocks' and to_card_id in (select id from c) group by to_card_id),
    fv as (select card_id, jsonb_object_agg(field_id, value) as v
           from card_field_values where card_id in (select id from c) group by card_id)
    select c.id, c.column_id as "columnId", c.title, c.description, c.position,
           c.start_date::text as "startDate", c.due_date::text as "dueDate", c.priority,
           c.estimate::float8 as estimate, c.cover_attachment_id as "coverAttachmentId",
           c.skip_automations as "skipAutomations", c.stickers,
           c.completed_at as "completedAt",
           c.created_by as "createdBy", c.created_at as "createdAt",
           u.name as "createdByName",
           coalesce(tg.ids, '{}') as "tagIds",
           coalesce(asg.ids, '{}') as "assigneeIds",
           coalesce(ci.done, 0) as "checklistDone",
           coalesce(ci.total, 0) as "checklistTotal",
           coalesce(cm.n, 0) as "commentCount",
           coalesce(att.n, 0) as "attachmentCount",
           coalesce(te.n, 0) as "timeMinutes",
           w.card_id is not null as watching,
           coalesce(bl.ids, '{}') as "blockerIds",
           coalesce(fv.v, '{}') as fields
    from c
    left join users u on u.id = c.created_by
    left join tg on tg.card_id = c.id
    left join asg on asg.card_id = c.id
    left join ci on ci.card_id = c.id
    left join cm on cm.card_id = c.id
    left join att on att.card_id = c.id
    left join te on te.card_id = c.id
    left join w on w.card_id = c.id
    left join bl on bl.card_id = c.id
    left join fv on fv.card_id = c.id
    order by c.position
  `)
  return rows.map(({ checklistDone, checklistTotal, createdAt, completedAt, ...c }) => ({
    ...c,
    createdAt: new Date(createdAt).toISOString(),
    completedAt: completedAt ? new Date(completedAt).toISOString() : null,
    checklist: { done: checklistDone, total: checklistTotal },
  }))
}

/** One unarchived card, or 404. */
export async function loadCard(tx: Tx, id: string): Promise<Card> {
  const [card] = await loadCards(tx, sql`c.id = ${id} and c.archived_at is null`)
  return card ?? notFound('Card not found')
}

/** Minutes in one time entry: up to a week. */
export const timeMinutes = z.number().int().min(1).max(7 * 24 * 60)

/** Time entries matching `where` (a condition on alias te), newest first, with the person's name. */
export async function loadTimeEntries(tx: Tx, where: SQL): Promise<TimeEntry[]> {
  // users rows are visible only while the person shares a board or team with the caller.
  const rows = await tx.execute<Omit<TimeEntry, 'createdAt'> & { createdAt: Date } & Record<string, unknown>>(sql`
    select te.id, te.user_id as "userId", u.name as "userName", te.minutes, te.spent_on::text as "spentOn",
           te.note, te.created_at as "createdAt"
    from time_entries te left join users u on u.id = te.user_id
    where ${where}
    order by te.spent_on desc, te.created_at desc
  `)
  return rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }))
}

/** Links of a card in both directions, oldest first, with the other card's title, column and archived state. */
export async function loadCardLinks(tx: Tx, where: SQL): Promise<CardLink[]> {
  const rows = await tx.execute<Omit<CardLink, 'card'> & { cardId: string, title: string, columnId: string, columnTitle: string, archived: boolean, completed: boolean } & Record<string, unknown>>(sql`
    select l.id, l.kind, l.direction, o.id as "cardId", o.title, o.column_id as "columnId", col.title as "columnTitle",
           o.archived_at is not null as archived, o.completed_at is not null as completed
    from (
      select id, kind, from_card_id as card_id, to_card_id as other_id, 'out' as direction, created_at from card_links
      union all
      select id, kind, to_card_id, from_card_id, 'in', created_at from card_links
    ) l
    join cards o on o.id = l.other_id
    join columns col on col.id = o.column_id
    where ${where}
    order by l.created_at, l.id
  `)
  return rows.map(({ cardId, title, columnId, columnTitle, archived, completed, ...l }) => ({ ...l, card: { id: cardId, title, columnId, columnTitle, archived, completed } }))
}

/** The board of a card the user can see, or 404. */
export async function cardBoardId(tx: Tx, cardId: string): Promise<string> {
  const { cards } = schema
  const [row] = await tx.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, cardId))
  return row?.boardId ?? notFound('Card not found')
}
