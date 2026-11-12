import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Person } from '#shared/types/board'

const query = z.object({ q: z.string().trim().max(200).catch('') })

const LIMIT = 8

/**
 * People to suggest when adding members: everyone the caller already shares a
 * board or team with (RLS on users decides; admins see every account), except
 * the caller, matching `q` in name or email. Empty `q` lists them by name.
 */
export default defineUserHandler(async (event, tx, userId): Promise<Person[]> => {
  const { q } = query.parse(getQuery(event))
  const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const prefix = `${q.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const rows = await tx.execute<{ id: string, name: string, email: string, avatar_url: string | null }>(sql`
    select id, name, email, avatar_url from users
    where id <> ${userId} and (name ilike ${like} or email ilike ${like})
    order by (name ilike ${prefix} or email ilike ${prefix}) desc, lower(name), email
    limit ${LIMIT}`)
  return rows.map(r => ({ userId: r.id, name: r.name, email: r.email, avatarUrl: r.avatar_url }))
})
