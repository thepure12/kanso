import { asc, eq, sql } from 'drizzle-orm'
import type { TeamDetail } from '#shared/types/board'

/** A team the user belongs to, with members, invites and boards. 404 when not visible (RLS). */
export default defineUserHandler(async (event, tx): Promise<TeamDetail> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { invites, teams, teamMembers: tm, users } = schema
  const [team] = await tx.select({ id: teams.id, name: teams.name, role: sql<TeamDetail['role']>`app.team_role(${teams.id})` })
    .from(teams).where(eq(teams.id, id))
  if (!team) notFound('Team not found')

  const [members, inviteRows, boards] = await Promise.all([
    tx.select({ userId: tm.userId, role: tm.role, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(tm).innerJoin(users, eq(users.id, tm.userId)).where(eq(tm.teamId, id)).orderBy(asc(tm.role), asc(users.name)),
    tx.select({ id: invites.id, email: invites.email, role: invites.role, createdAt: invites.createdAt })
      .from(invites).where(eq(invites.teamId, id)).orderBy(asc(invites.email)),
    loadBoardSummaries(tx, sql`b.team_id = ${id}`),
  ])
  return {
    ...team,
    members,
    invites: inviteRows.map(i => ({ ...i, createdAt: i.createdAt.toISOString() })),
    boards,
  }
})
