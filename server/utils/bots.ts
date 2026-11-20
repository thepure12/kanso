import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { BoardBot, BotRole, BotToken } from '#shared/types/bots'

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

/** Where a bot lives: a board (board bots) or a team (team bots). */
export type BotScope = { board: string, team: null } | { board: null, team: string }

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

/** The bot's board or team when the caller sees the bot (people on its board or team), else 404. */
export async function botScope(tx: Tx, botId: string): Promise<BotScope> {
  const [row] = await tx.execute<{ board: string | null, team: string | null }>(
    sql`select bot_board_id as board, bot_team_id as team from users where id = ${botId} and is_bot`)
  if (!row) notFound('Bot not found')
  return row.board !== null ? { board: row.board, team: null } : { board: null, team: row.team! }
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
