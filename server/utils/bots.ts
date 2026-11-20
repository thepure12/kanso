import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AccountBot, BoardBot, BotRole, BotToken } from '#shared/types/bots'

export const botRoles = ['editor', 'commenter', 'viewer'] as const satisfies readonly BotRole[]
export const botNameSchema = z.string().trim().min(1).max(100)

interface BotRow extends Record<string, unknown> {
  id: string
  name: string
  role: BotRole
  avatarUrl: string | null
  createdAt: Date | string
}

interface TokenRow extends Record<string, unknown> {
  bot: string
  id: string
  name: string
  prefix: string
  scopes: BotToken['scopes']
  createdAt: Date | string
  lastUsedAt: Date | string | null
  expiresAt: Date | string | null
  revokedAt: Date | string | null
}

const iso = (d: Date | string) => new Date(d).toISOString()
const isoOrNull = (d: Date | string | null) => d === null ? null : iso(d)

/** Where a bot lives: a board (board bots), a team (team bots) or a person's account (both null). */
export type BotScope = { board: string, team: null } | { board: null, team: string } | { board: null, team: null }

/**
 * A board's bots by name (plain SELECTs under RLS: people on the board see
 * them). Tokens come from app.bot_tokens, which only effective owners may call,
 * so they are loaded only when `owner` is true (else null).
 */
export function loadBots(tx: Tx, boardId: string, owner: boolean): Promise<BoardBot[]> {
  return loadScopeBots(tx, { board: boardId, team: null }, owner)
}

/** A team's bots (team members see them); tokens only for team owners (`owner`). */
export function loadTeamBots(tx: Tx, teamId: string, owner: boolean): Promise<BoardBot[]> {
  return loadScopeBots(tx, { board: null, team: teamId }, owner)
}

/** The bots of a board or team, with their board or team role. */
export async function loadScopeBots(tx: Tx, scope: BotScope, owner: boolean): Promise<BoardBot[]> {
  if (isAccountScope(scope)) return []
  const where = scope.board !== null ? sql`u.bot_board_id = ${scope.board}` : sql`u.bot_team_id = ${scope.team}`
  const bots = await tx.execute<BotRow>(scope.board !== null
    ? sql`
      select u.id, u.name, m.role, u.avatar_url as "avatarUrl", u.created_at as "createdAt"
      from users u join board_members m on m.board_id = u.bot_board_id and m.user_id = u.id
      where u.is_bot and ${where}
      order by lower(u.name), u.id`
    : sql`
      select u.id, u.name, m.role, u.avatar_url as "avatarUrl", u.created_at as "createdAt"
      from users u join team_members m on m.team_id = u.bot_team_id and m.user_id = u.id
      where u.is_bot and ${where}
      order by lower(u.name), u.id`)
  let tokens = new Map<string, BotToken[]>()
  if (owner && bots.length) {
    const rows = await tx.execute<TokenRow>(sql`
      select u.id as bot, t.id, t.name, t.prefix, t.scopes, t.created_at as "createdAt",
             t.last_used_at as "lastUsedAt", t.expires_at as "expiresAt", t.revoked_at as "revokedAt"
      from users u, lateral app.bot_tokens(u.id) t
      where u.is_bot and ${where}
      order by t.created_at desc, t.id
    `)
    tokens = new Map([...Map.groupBy(rows, r => r.bot)].map(([bot, list]) => [bot, list.map(toBotToken)]))
  }
  return bots.map(b => ({
    id: b.id, name: b.name, role: b.role, avatarUrl: b.avatarUrl, createdAt: iso(b.createdAt),
    tokens: owner ? tokens.get(b.id) ?? [] : null,
  }))
}

function toBotToken(r: TokenRow): BotToken {
  return {
    id: r.id, name: r.name, prefix: r.prefix, scopes: r.scopes, createdAt: iso(r.createdAt),
    lastUsedAt: isoOrNull(r.lastUsedAt), expiresAt: isoOrNull(r.expiresAt), revokedAt: isoOrNull(r.revokedAt),
  }
}

/**
 * The bot's board or team (both null for account bots) when the caller sees
 * the bot (people on its board or team, an account bot's owner and the people
 * on its boards), else 404.
 */
export async function botScope(tx: Tx, botId: string): Promise<BotScope> {
  const [row] = await tx.execute<{ board: string | null, team: string | null }>(
    sql`select bot_board_id as board, bot_team_id as team from users where id = ${botId} and is_bot`)
  if (!row) notFound('Bot not found')
  if (row.board !== null) return { board: row.board, team: null }
  return row.team !== null ? { board: null, team: row.team } : { board: null, team: null }
}

export const isAccountScope = (s: BotScope): s is { board: null, team: null } => s.board === null && s.team === null

/**
 * The caller's account bots by name, with their tokens and boards (or just
 * the one with `onlyId`). Tokens through app.bot_tokens, boards through
 * app.my_bot_boards (also boards the owner no longer sees).
 */
export async function loadAccountBots(tx: Tx, onlyId?: string): Promise<AccountBot[]> {
  const only = onlyId ? sql`and u.id = ${onlyId}` : sql``
  const bots = await tx.execute<{ id: string, name: string, avatarUrl: string | null, createdAt: Date | string }>(sql`
    select u.id, u.name, u.avatar_url as "avatarUrl", u.created_at as "createdAt"
    from users u
    where u.is_bot and u.bot_owner_id = app.current_user_id() ${only}
    order by lower(u.name), u.id`)
  if (!bots.length) return []
  const [tokens, boards] = await Promise.all([
    tx.execute<TokenRow>(sql`
      select u.id as bot, t.id, t.name, t.prefix, t.scopes, t.created_at as "createdAt",
             t.last_used_at as "lastUsedAt", t.expires_at as "expiresAt", t.revoked_at as "revokedAt"
      from users u, lateral app.bot_tokens(u.id) t
      where u.is_bot and u.bot_owner_id = app.current_user_id() ${only}
      order by t.created_at desc, t.id`),
    tx.execute<{ bot: string, id: string, name: string, role: BotRole, owner: boolean }>(sql`
      select bot_id as bot, board_id as id, board_name as name, role, coalesce(owner, false) as owner
      from app.my_bot_boards()`),
  ])
  const tokensByBot = Map.groupBy(tokens, r => r.bot)
  const boardsByBot = Map.groupBy(boards, r => r.bot)
  return bots.map(b => ({
    id: b.id, name: b.name, avatarUrl: b.avatarUrl, createdAt: iso(b.createdAt),
    tokens: (tokensByBot.get(b.id) ?? []).map(toBotToken),
    boards: (boardsByBot.get(b.id) ?? []).map(({ id, name, role, owner }) => ({ id, name, role, owner })),
  }))
}

/** One bot as its manager sees it after a change: an account bot of the caller, or a board/team bot with tokens. */
export async function loadManagedBot(tx: Tx, scope: BotScope, botId: string): Promise<BoardBot | AccountBot> {
  const bot = isAccountScope(scope)
    ? (await loadAccountBots(tx, botId))[0]
    : (await loadScopeBots(tx, scope, true)).find(b => b.id === botId)
  return bot ?? notFound('Bot not found')
}

/** Whether the caller is an owner of the team. */
export async function isTeamOwner(tx: Tx, teamId: string): Promise<boolean> {
  const [row] = await tx.execute<{ owner: boolean }>(sql`select app.team_role(${teamId}) = 'owner' as owner`)
  return row?.owner === true
}

/** Whether the caller is an effective owner of the board. */
export async function isBoardOwner(tx: Tx, boardId: string): Promise<boolean> {
  const [row] = await tx.execute<{ owner: boolean }>(sql`select app.board_role(${boardId}) = 'owner' as owner`)
  return row?.owner === true
}
