import { sql } from 'drizzle-orm'
import type { MyWorkOptions } from '#shared/types/myWork'

// Choices for the My work panel editor: boards, column titles and card tag
// names (distinct case-insensitively) of unarchived boards, and people.
// Plain SELECTs under RLS: only what the caller can see.
export default defineUserHandler(async (_event, tx, userId): Promise<MyWorkOptions> => {
  const boards = await tx.execute<{ id: string, name: string }>(sql`
    select id, name from boards where archived_at is null order by lower(name), id`)
  const columns = await tx.execute<{ title: string }>(sql`
    select distinct on (lower(c.title)) c.title from columns c join boards b on b.id = c.board_id
    where b.archived_at is null order by lower(c.title), c.position`)
  const tags = await tx.execute<{ name: string, color: string }>(sql`
    select distinct on (lower(t.name)) t.name, t.color from tags t join boards b on b.id = t.board_id
    where b.archived_at is null order by lower(t.name), t.created_at`)
  const people = await tx.execute<{ id: string, name: string, avatarUrl: string | null, isBot: boolean }>(sql`
    select id, name, avatar_url as "avatarUrl", is_bot as "isBot" from users
    order by id <> ${userId}, is_bot, lower(name), id limit 500`)
  return { boards: [...boards], columns: columns.map(c => c.title), tags: [...tags], people: [...people] }
})
