import { sql, type SQL } from 'drizzle-orm'
import type { BoardSummary } from '#shared/types/board'

/** Boards matching `where` (a condition on alias b) that the user can see, oldest first. */
export async function loadBoardSummaries(tx: Tx, where: SQL = sql`true`): Promise<BoardSummary[]> {
  // RLS limits boards to those the user can reach directly or through a team.
  const rows = await tx.execute<Omit<BoardSummary, 'archivedAt'> & { archivedAt: Date | string | null } & Record<string, unknown>>(sql`
    select b.id, b.name, b.team_id as "teamId",
           app.board_role(b.id) as role,
           (select count(*)::int from app.board_people(b.id)) as "memberCount",
           exists(select 1 from board_stars s where s.board_id = b.id and s.user_id = app.current_user_id()) as starred,
           b.archived_at as "archivedAt"
    from boards b
    where ${where}
    order by b.created_at
  `)
  return rows.map(r => ({ ...r, archivedAt: r.archivedAt ? new Date(r.archivedAt).toISOString() : null }))
}

/** Throws 404 unless the user can see board `id`. */
export async function assertBoardVisible(tx: Tx, id: string): Promise<void> {
  const [row] = await tx.execute(sql`select 1 from boards where id = ${id}`)
  if (!row) notFound('Board not found')
}
