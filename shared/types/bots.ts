import type { ApiTokenScope } from '../webhooks'
import type { BoardRole } from './board'

/** Roles a bot can have on its board or team: never owner. */
export type BotRole = Exclude<BoardRole, 'owner'>

/** An API token of a bot (never the token itself: its POST response, or the reveal route with a TOTP code). */
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
  /** Whether its manager can see it again (POST /api/bots/:id/tokens/:tokenId/reveal). */
  viewable: boolean
  lastViewedAt: string | null
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

/** A board an account bot is on, with its role there. */
export interface AccountBotBoard {
  id: string
  name: string
  role: BotRole
  /** Whether the caller (the bot's owner) owns the board, so may change the bot's role there. */
  owner: boolean
}

/**
 * A bot of the caller's account (0109_account_bots_rls.sql): the owner adds it
 * to boards they own; its tokens reach the boards it is on.
 */
export interface AccountBot {
  id: string
  name: string
  avatarUrl: string | null
  createdAt: string
  /** Newest first, revoked ones included. */
  tokens: BotToken[]
  boards: AccountBotBoard[]
}
