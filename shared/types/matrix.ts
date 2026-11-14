/** The Matrix room a board is connected to (BoardDetail.matrix; the bot's token is never returned). */
export interface BoardMatrixRoom {
  /** Client API base URL of the bot's homeserver. */
  homeserverUrl: string
  roomId: string
  roomName: string | null
  /** The bot account, e.g. @kanso-bot:example.org. */
  botUserId: string
}

/** The Matrix thread a card is linked to (CardDetail.matrixThread). */
export interface CardMatrixThread {
  roomId: string
  /** Root event of the thread. */
  eventId: string
}
