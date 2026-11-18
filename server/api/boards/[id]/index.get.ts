import { and, asc, eq, sql } from 'drizzle-orm'
import type { BoardDetail, Member } from '#shared/types/board'

export default defineUserHandler(async (event, tx): Promise<BoardDetail> => {
  const { id } = await paramsValidated(event, uuidParam)
  const { boards, boardAutomations, cardScheduledActions, columns, columnRules, invites, tags, teams } = schema

  const [board] = await tx.select({
    id: boards.id, name: boards.name, teamId: boards.teamId, teamName: teams.name, archivedAt: boards.archivedAt, background: boards.background, accent: boards.accent, columnOutline: boards.columnOutline,
    starred: sql<boolean>`exists(select 1 from board_stars s where s.board_id = ${boards.id} and s.user_id = app.current_user_id())`,
    notificationLevel: sql<'direct' | 'none' | null>`(select n.level from board_notification_settings n where n.board_id = ${boards.id} and n.user_id = app.current_user_id())`,
  })
    .from(boards).leftJoin(teams, eq(teams.id, boards.teamId)).where(eq(boards.id, id))
  if (!board) notFound('Board not found')

  const [cols, ruleRows, cardRows, templates, recurrences, automationRows, scheduledRows, tagRows, fields, columnGroups, savedViews, matrix, members, inviteRows, [me], memberAccess] = await Promise.all([
    tx.select({ id: columns.id, title: columns.title, position: columns.position, color: columns.color, wipLimit: columns.wipLimit, outline: columns.outline })
      .from(columns).where(eq(columns.boardId, id)).orderBy(asc(columns.position)),
    tx.select({ ...columnRuleFields, columnId: columnRules.columnId })
      .from(columnRules).where(eq(columnRules.boardId, id)).orderBy(asc(columnRules.createdAt)),
    loadCards(tx, sql`c.board_id = ${id} and c.archived_at is null and c.snoozed_until is null and not c.is_template`),
    loadCards(tx, sql`c.board_id = ${id} and c.archived_at is null and c.is_template`)
      .then(list => list.sort((a, b) => a.title.localeCompare(b.title))),
    loadRecurrences(tx, { boardId: id }),
    tx.select(boardAutomationFields).from(boardAutomations)
      // A trashed card's automations and actions stay until it is purged, but are hidden (cards_select).
      .where(and(eq(boardAutomations.boardId, id), sql`(${boardAutomations.cardId} is null or exists (select 1 from cards c where c.id = ${boardAutomations.cardId}))`))
      .orderBy(asc(boardAutomations.createdAt)),
    tx.select(scheduledActionFields).from(cardScheduledActions)
      .where(and(eq(cardScheduledActions.boardId, id), sql`exists (select 1 from cards c where c.id = ${cardScheduledActions.cardId})`)).orderBy(asc(cardScheduledActions.runOn), asc(cardScheduledActions.createdAt)),
    tx.select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags).where(eq(tags.boardId, id)).orderBy(asc(tags.name)),
    loadBoardFields(tx, id),
    loadColumnGroups(tx, id),
    loadSavedViews(tx, id),
    loadMatrixRoom(tx, id),
    tx.execute<Member & Record<string, unknown>>(sql`
      select p.user_id as "userId", p.role, p.board_role as "boardRole", p.team_role as "teamRole",
             u.name, u.email, u.avatar_url as "avatarUrl"
      from app.board_people(${id}) p join users u on u.id = p.user_id
      order by p.role, u.name
    `),
    tx.select({ id: invites.id, email: invites.email, role: invites.role, createdAt: invites.createdAt })
      .from(invites).where(eq(invites.boardId, id)).orderBy(asc(invites.email)),
    tx.execute<{ role: BoardDetail['role'], userId: string }>(sql`select app.board_role(${id}) as role, app.current_user_id() as "userId"`),
    loadMemberAccess(tx, id),
  ])

  const rulesByColumn = Map.groupBy(ruleRows, r => r.columnId)

  return {
    id: board.id,
    name: board.name,
    role: me!.role,
    archivedAt: board.archivedAt?.toISOString() ?? null,
    starred: board.starred,
    notificationLevel: board.notificationLevel ?? 'all',
    matrix,
    background: board.background ?? null,
    accent: board.accent ?? null,
    columnOutline: board.columnOutline ?? null,
    team: board.teamId ? { id: board.teamId, name: board.teamName! } : null,
    columns: cols.map(c => ({ ...c, rules: (rulesByColumn.get(c.id) ?? []).map(toColumnRule) })),
    columnGroups,
    savedViews,
    cards: cardRows,
    templates,
    recurrences,
    automations: automationRows.map(toBoardAutomation),
    scheduledActions: scheduledRows.map(toScheduledAction),
    tags: tagRows,
    fields,
    members: [...members],
    invites: inviteRows.map(i => ({ ...i, createdAt: i.createdAt.toISOString() })),
    myAccess: me!.role === 'owner' ? null : memberAccess[me!.userId] ?? null,
    memberAccess,
  }
})
