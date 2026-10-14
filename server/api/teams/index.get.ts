import { asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { TeamSummary } from '#shared/types/board'

export default defineUserHandler(async (_event, tx): Promise<TeamSummary[]> => {
  const { invites, teams, teamMembers: tm, users } = schema
  const [teamRows, memberRows, inviteRows] = await Promise.all([
    tx.select({ id: teams.id, name: teams.name, role: sql<TeamSummary['role']>`app.team_role(${teams.id})` })
      .from(teams).orderBy(asc(teams.createdAt)),
    tx.select({ teamId: tm.teamId, userId: tm.userId, role: tm.role, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
      .from(tm).innerJoin(users, eq(users.id, tm.userId)).orderBy(asc(tm.role), asc(users.name)),
    tx.select({ teamId: invites.teamId, id: invites.id, email: invites.email, role: invites.role, createdAt: invites.createdAt })
      .from(invites).where(isNotNull(invites.teamId)).orderBy(asc(invites.email)),
  ])
  return teamRows.map(t => ({
    ...t,
    members: memberRows.filter(m => m.teamId === t.id).map(({ teamId: _, ...m }) => m),
    invites: inviteRows.filter(i => i.teamId === t.id).map(({ teamId: _, createdAt, ...i }) => ({ ...i, createdAt: createdAt.toISOString() })),
  }))
})
