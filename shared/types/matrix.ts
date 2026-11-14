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

/** One message of a card's Matrix thread (GET /api/cards/:id/matrix-thread). */
export interface MatrixThreadMessage {
  id: string
  sender: string
  /** Room display name, else the user id. */
  senderName: string
  /** Sent by the board's bot (thread roots and replies from Kanso). */
  fromBot: boolean
  /** Written in Kanso by this person (the bot posted it for them); senderName is then their name. */
  kansoAuthorId: string | null
  createdAt: string
  /** Plain text. */
  body: string
  /** Matrix HTML (org.matrix.custom.html), unsanitized: the browser sanitizes it. */
  html: string | null
  edited: boolean
}

/** A card's Matrix thread with its messages, root first. */
export interface MatrixThreadView extends CardMatrixThread {
  messages: MatrixThreadMessage[]
  /** Older replies were left out (the newest 200 are shown). */
  more: boolean
}
