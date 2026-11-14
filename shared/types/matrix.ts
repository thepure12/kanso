/** The Matrix room a board is connected to (BoardDetail.matrix; the bot's token is never returned). */
export interface BoardMatrixRoom {
  /** Client API base URL of the bot's homeserver. */
  homeserverUrl: string
  roomId: string
  roomName: string | null
  /** The bot account, e.g. @kanso-bot:example.org. */
  botUserId: string
}
