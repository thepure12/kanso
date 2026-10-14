import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardActivity, BoardActivityPage } from '#shared/types/board'

// Cursor: base64url of "<created_at as Postgres text>|<id>". The text keeps
// microseconds, which a JS Date would drop, so the keyset stays exact.
const cursor = z.string().max(200).transform((c, ctx) => {
  const [ts, id] = Buffer.from(c, 'base64url').toString().split('|')
  if (!ts || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d(:?\d\d)?|Z)$/.test(ts) || !z.uuid().safeParse(id).success) {
    ctx.addIssue({ code: 'custom', message: 'Invalid cursor' })
    return z.NEVER
  }
  return { ts, id: id! }
})

const query = z.object({
  before: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

type Row = Omit<BoardActivity, 'createdAt'> & { createdAt: Date, ts: string }

/** The board's card activity, newest first, keyset paginated (RLS limits it to visible boards). */
export default defineUserHandler(async (event, tx): Promise<BoardActivityPage> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { before, limit } = await getValidatedQuery(event, q => query.parse(q))
  await assertBoardVisible(tx, id)

  const rows = await tx.execute<Row & Record<string, unknown>>(sql`
    select a.id, a.card_id as "cardId", c.title as "cardTitle", a.actor_id as "actorId", u.name as "actorName",
           a.kind, a.data, a.created_at as "createdAt", a.created_at::text as ts
    from card_activity a
    join cards c on c.id = a.card_id
    left join users u on u.id = a.actor_id
    where a.board_id = ${id}
      ${before ? sql`and (a.created_at, a.id) < (${before.ts}::timestamptz, ${before.id}::uuid)` : sql``}
    order by a.created_at desc, a.id desc
    limit ${limit + 1}
  `)
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(({ ts: _, ...a }) => ({ ...a, createdAt: new Date(a.createdAt).toISOString() })),
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.ts}|${last.id}`).toString('base64url') : null,
  }
})
