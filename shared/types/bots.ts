import type { ApiTokenScope } from '../webhooks'
import type { BoardRole } from './board'

/** Roles a bot can have on its board or team: never owner. */
export type BotRole = Exclude<BoardRole, 'owner'>

/** An API token of a board bot (never the token itself, which only its POST response holds). */
export interface BotToken {
  id: string
  name: string
  /** The first characters, to tell tokens apart, e.g. "kb_Ab12Cd". */
  prefix: string
  scopes: ApiTokenScope[]
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

/** A bot user of one board (0102_board_bots_rls.sql) or team (0106_team_bots_rls.sql); it acts only through its board- or team-limited tokens. */
export interface BoardBot {
  id: string
  name: string
  role: BotRole
  avatarUrl: string | null
  createdAt: string
  /** Newest first, revoked ones included; null unless the caller owns the board. */
  tokens: BotToken[] | null
}
