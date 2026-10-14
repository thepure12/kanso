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

type CardRow = Omit<Card, 'checklist'> & { checklistDone: number, checklistTotal: number }

/** Cards matching `where` (a condition on alias c), in position order, with tags, assignees, field values and counts. */
export async function loadCards(tx: Tx, where: SQL): Promise<Card[]> {
  const rows = await tx.execute<CardRow & Record<string, unknown>>(sql`
    select c.id, c.column_id as "columnId", c.title, c.description, c.position,
           c.start_date::text as "startDate", c.due_date::text as "dueDate", c.priority,
           c.estimate::float8 as estimate, c.cover_attachment_id as "coverAttachmentId",
           array(select ct.tag_id::text from card_tags ct join tags t on t.id = ct.tag_id
                 where ct.card_id = c.id order by t.name) as "tagIds",
           array(select ca.user_id::text from card_assignees ca where ca.card_id = c.id order by ca.user_id) as "assigneeIds",
           (select count(*) filter (where ci.done) from checklist_items ci where ci.card_id = c.id)::int as "checklistDone",
           (select count(*) from checklist_items ci where ci.card_id = c.id)::int as "checklistTotal",
           (select count(*) from card_comments cc where cc.card_id = c.id)::int as "commentCount",
           (select count(*) from card_attachments a where a.card_id = c.id)::int as "attachmentCount",
           (select coalesce(sum(te.minutes), 0) from time_entries te where te.card_id = c.id)::int as "timeMinutes",
           exists(select 1 from card_watchers w where w.card_id = c.id and w.user_id = app.current_user_id()) as watching,
           array(select l.from_card_id::text from card_links l where l.to_card_id = c.id and l.kind = 'blocks'
                 order by l.from_card_id) as "blockerIds",
           (select coalesce(jsonb_object_agg(v.field_id, v.value), '{}') from card_field_values v
            where v.card_id = c.id) as fields
    from cards c
    where ${where}
    order by c.position
  `)
  return rows.map(({ checklistDone, checklistTotal, ...c }) => ({ ...c, checklist: { done: checklistDone, total: checklistTotal } }))
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
  const rows = await tx.execute<Omit<CardLink, 'card'> & { cardId: string, title: string, columnId: string, columnTitle: string, archived: boolean } & Record<string, unknown>>(sql`
    select l.id, l.kind, l.direction, o.id as "cardId", o.title, o.column_id as "columnId", col.title as "columnTitle",
           o.archived_at is not null as archived
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
  return rows.map(({ cardId, title, columnId, columnTitle, archived, ...l }) => ({ ...l, card: { id: cardId, title, columnId, columnTitle, archived } }))
}

/** The board of a card the user can see, or 404. */
export async function cardBoardId(tx: Tx, cardId: string): Promise<string> {
  const { cards } = schema
  const [row] = await tx.select({ boardId: cards.boardId }).from(cards).where(eq(cards.id, cardId))
  return row?.boardId ?? notFound('Card not found')
}
