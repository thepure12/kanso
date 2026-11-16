/** The Matrix room a board is connected to (BoardDetail.matrix; the bot's token is never returned). */
export interface BoardMatrixRoom {
  /** Client API base URL of the bot's homeserver. */
  homeserverUrl: string
  roomId: string
  roomName: string | null
  /** The bot account, e.g. @kanso-bot:example.org. */
  botUserId: string
  /** The bot posts card activity into linked card threads. */
  postActivity: boolean
  /** Activity kinds it posts; empty = all. */
  activityEvents: string[]
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
  /** The Kanso person behind it: kansoAuthorId, or whoever linked the sender's Matrix ID on the board. */
  kansoUserId: string | null
  createdAt: string
  /** Plain text. */
  body: string
  /** Matrix HTML (org.matrix.custom.html), unsanitized: the browser sanitizes it. */
  html: string | null
  edited: boolean
  /** An image (m.image or sticker): served through the card's media route. */
  image?: MatrixThreadImage
}

/** An image in a thread message. URLs are app paths without the base path (wrap in appUrl). */
export interface MatrixThreadImage {
  /** Full size. */
  url: string
  /** At most 800×600, animation kept. */
  thumbnailUrl: string
  name: string
  width: number | null
  height: number | null
}

/** A card's Matrix thread with its messages, root first. */
export interface MatrixThreadView extends CardMatrixThread {
  boardId: string
  messages: MatrixThreadMessage[]
  /** Older replies were left out (the newest 200 are shown). */
  more: boolean
  /** The caller's Matrix account on this board, if they linked or started linking one. */
  myLink: MatrixUserLink | null
}

/** A person's Matrix account on a board (/api/boards/:id/matrix/link). */
export interface MatrixUserLink {
  mxid: string
  verified: boolean
  /** While pending: the code to send in the board's room from that account. */
  code: string | null
  codeExpiresAt: string | null
}

/**
 * Why a Matrix request failed, sent as `data.problem` with a 400 (and
 * `data.bot`, the bot's Matrix ID when known) so the UI can explain it.
 */
export type MatrixProblem = 'token' | 'rateLimited' | 'encrypted' | 'cannotJoin' | 'eventHidden' | 'notInRoom' | 'forbidden' | 'httpAuth' | 'unreachable'
