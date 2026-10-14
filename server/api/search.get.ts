import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardHit, CardHit, ColumnHit, SearchResults } from '#shared/types/search'

const query = z.object({
  q: z.string().trim().max(200).default(''),
  archived: z.enum(['0', '1']).default('0'),
})

const CARD_LIMIT = 30
const OTHER_LIMIT = 8
// Plain text: the palette shows snippets as text, never as HTML.
const HEADLINE = 'StartSel="", StopSel="", MaxWords=20, MinWords=8, ShortWord=2, MaxFragments=1'

/** Cards, boards and columns matching `q` across every board the user can see (RLS does the limiting). */
export default defineUserHandler(async (event, tx): Promise<SearchResults> => {
  const input = await getValidatedQuery(event, q => query.parse(q))
  const tsq = toPrefixTsquery(input.q)
  if (!tsq) return { cards: [], boards: [], columns: [] }
  const withArchived = input.archived === '1'

  const [cards, boards, columns] = await Promise.all([
    // Cards rank by their own match (title weighs more than description), or by
    // their best comment at half weight. Both go through the GIN indexes.
    tx.execute<CardHit & Record<string, unknown>>(sql`
      with q as (select to_tsquery('simple', ${tsq}) as q),
      matched as (
        select c.id as card_id, ts_rank(c.search, q.q) as rank, false as in_comment
        from cards c, q where c.search @@ q.q
        union all
        select cm.card_id, ts_rank(cm.search, q.q) * 0.5, true
        from card_comments cm, q where cm.search @@ q.q
      ),
      top as (
        select m.card_id, max(m.rank) as rank, bool_and(m.in_comment) as in_comment, c.updated_at
        from matched m join cards c on c.id = m.card_id join boards b on b.id = c.board_id
        where not c.is_template and (${withArchived} or (c.archived_at is null and b.archived_at is null))
        group by m.card_id, c.updated_at
        order by rank desc, c.updated_at desc
        limit ${CARD_LIMIT}
      )
      select c.id, c.title, top.in_comment as "inComment", (c.archived_at is not null or b.archived_at is not null) as archived,
             c.board_id as "boardId", b.name as "boardName", c.column_id as "columnId", col.title as "columnName",
             case
               when top.in_comment then ts_headline('simple', cm.body, q.q, ${HEADLINE})
               when c.description <> '' then ts_headline('simple', c.description, q.q, ${HEADLINE})
             end as snippet
      from top
      cross join q
      join cards c on c.id = top.card_id
      join columns col on col.id = c.column_id
      join boards b on b.id = c.board_id
      left join lateral (
        select body from card_comments cm
        where top.in_comment and cm.card_id = c.id and cm.search @@ q.q
        order by ts_rank(cm.search, q.q) desc limit 1
      ) cm on true
      order by top.rank desc, top.updated_at desc
    `),
    tx.execute<BoardHit & Record<string, unknown>>(sql`
      select b.id, b.name
      from boards b, to_tsquery('simple', ${tsq}) q
      where to_tsvector('simple', b.name) @@ q
      order by ts_rank(to_tsvector('simple', b.name), q) desc, b.name
      limit ${OTHER_LIMIT}
    `),
    tx.execute<ColumnHit & Record<string, unknown>>(sql`
      select col.id, col.title, col.board_id as "boardId", b.name as "boardName"
      from columns col join boards b on b.id = col.board_id, to_tsquery('simple', ${tsq}) q
      where to_tsvector('simple', col.title) @@ q and (${withArchived} or b.archived_at is null)
      order by ts_rank(to_tsvector('simple', col.title), q) desc, b.name, col.position
      limit ${OTHER_LIMIT}
    `),
  ])

  return {
    cards: cards.map(c => ({ ...c, snippet: c.snippet?.replace(/\s+/g, ' ').trim() || null })),
    boards: [...boards],
    columns: [...columns],
  }
})
