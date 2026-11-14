import { sql } from 'drizzle-orm'
import { sealSecret, openSecret, secretKey } from './secretBox'
import { httpRequest } from './webhookHttp'

/**
 * A small Matrix Client-Server API client for the board bot. Requests go
 * through httpRequest (no private addresses unless NUXT_WEBHOOK_ALLOW_PRIVATE,
 * no redirects, 5 s, 1 MB). The bot is an ordinary account: no homeserver admin
 * access is needed.
 */

export class MatrixError extends Error {
  constructor(message: string, readonly status: number | null, readonly errcode: string | null) {
    super(message)
  }
}

export interface MatrixClient {
  homeserverUrl: string
  accessToken: string
}

/** Key for sealing bot tokens: NUXT_TOTP_KEY or the session password, own HKDF info. */
function tokenKey() {
  const config = useRuntimeConfig()
  return secretKey(config.totpKey || config.session.password, 'kanban/matrix-token/v1')
}

export const sealMatrixToken = (token: string) => sealSecret(token, tokenKey())
export const openMatrixToken = (box: string) => openSecret(box, tokenKey())

/** Strips trailing slashes; the API paths are appended to it. */
const baseUrl = (url: string) => url.replace(/\/+$/, '')

async function call<T>(method: 'GET' | 'POST' | 'PUT', url: string, token: string | null, body?: unknown): Promise<T> {
  const res = await httpRequest({
    method,
    url,
    headers: {
      'accept': 'application/json',
      'user-agent': 'Kanso',
      ...(token && { authorization: `Bearer ${token}` }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    allowPrivate: webhookAllowPrivate(),
  })
  let json: Record<string, unknown> | null = null
  try {
    json = res.body ? JSON.parse(res.body) : null
  }
  catch { /* not JSON */ }
  if (!res.ok) {
    const errcode = typeof json?.errcode === 'string' ? json.errcode : null
    const msg = typeof json?.error === 'string' ? json.error : res.error ?? 'Request failed'
    throw new MatrixError(errcode ? `${errcode}: ${msg}` : msg, res.status, errcode)
  }
  if (!json || typeof json !== 'object') throw new MatrixError('The homeserver did not answer with JSON', res.status, null)
  return json as T
}

/** Calls `/_matrix/client/v3<path>` as the bot. */
export function matrixRequest<T>(c: MatrixClient, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  return call<T>(method, `${baseUrl(c.homeserverUrl)}/_matrix/client/v3${path}`, c.accessToken, body)
}

/**
 * The client API base URL for what the user typed: a full http(s) URL is used
 * as is; a server name (`example.org`) is looked up through
 * `https://<name>/.well-known/matrix/client`, falling back to `https://<name>`.
 */
export async function resolveHomeserver(input: string): Promise<string> {
  const v = input.trim()
  if (/^https?:\/\//i.test(v)) return baseUrl(v)
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(v)) throw new MatrixError('Enter a homeserver URL or server name', null, null)
  try {
    const wk = await call<{ 'm.homeserver'?: { base_url?: unknown } }>('GET', `https://${v}/.well-known/matrix/client`, null)
    const found = wk['m.homeserver']?.base_url
    if (typeof found === 'string' && /^https?:\/\//i.test(found)) return baseUrl(found)
  }
  catch { /* no well-known: use the name itself */ }
  return `https://${v}`
}

/**
 * The room id or alias in what the user typed: `!id:server`, `#alias:server`,
 * or a matrix.to link to either. Null when it is none of those.
 */
export function parseRoomInput(input: string): string | null {
  let v = input.trim()
  const link = /^https:\/\/matrix\.to\/#\/([^?/]+)/i.exec(v)
  if (link) {
    try {
      v = decodeURIComponent(link[1]!)
    }
    catch { return null }
  }
  return /^[!#][^:\s]+:[^\s]+$/.test(v) ? v : null
}

export interface MatrixRoomInfo {
  homeserverUrl: string
  roomId: string
  roomName: string | null
  botUserId: string
}

/**
 * Checks a connection before it is saved: the token is valid, the bot is in
 * the room (joining it when invited or public) and the room is not
 * end-to-end encrypted (the bot cannot read or write encrypted messages).
 */
export async function checkMatrixRoom(c: MatrixClient, room: string): Promise<MatrixRoomInfo> {
  const { user_id: botUserId } = await matrixRequest<{ user_id: string }>(c, 'GET', '/account/whoami')
  let roomId = room
  if (room.startsWith('#')) {
    roomId = (await matrixRequest<{ room_id: string }>(c, 'GET', `/directory/room/${encodeURIComponent(room)}`)).room_id
  }
  const { joined_rooms: joined } = await matrixRequest<{ joined_rooms: string[] }>(c, 'GET', '/joined_rooms')
  if (!joined.includes(roomId)) {
    try {
      await matrixRequest(c, 'POST', `/join/${encodeURIComponent(roomId)}`, {})
    }
    catch (e) {
      if (e instanceof MatrixError) throw new MatrixError(`The bot ${botUserId} is not in the room and cannot join it (${e.message}). Invite it first.`, e.status, e.errcode)
      throw e
    }
  }
  if (await roomState(c, roomId, 'm.room.encryption')) {
    throw new MatrixError('The room is end-to-end encrypted. Use a room without encryption.', null, 'KANSO_ENCRYPTED')
  }
  const name = await roomState<{ name?: unknown }>(c, roomId, 'm.room.name')
  return { homeserverUrl: c.homeserverUrl, roomId, roomName: typeof name?.name === 'string' && name.name ? name.name : null, botUserId }
}

/** A room state event's content, or null when the room has none of that type. */
async function roomState<T = Record<string, unknown>>(c: MatrixClient, roomId: string, type: string): Promise<T | null> {
  try {
    return await matrixRequest<T>(c, 'GET', `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/`)
  }
  catch (e) {
    if (e instanceof MatrixError && e.errcode === 'M_NOT_FOUND') return null
    throw e
  }
}

/** Throws a 400 carrying the Matrix error, for route handlers. */
export function matrixHttpError(e: unknown): never {
  if (e instanceof MatrixError) throw createError({ statusCode: 400, statusMessage: `Matrix: ${e.message}`.slice(0, 300), data: { errcode: e.errcode } })
  throw e
}

/**
 * The event in what the user typed: a bare `$event` id, or a matrix.to /
 * Element permalink (`…#/!room:server/$event`, `…#/room/#alias:server/$event`),
 * with the room it names. Null when it is none of those.
 */
export function parseEventInput(input: string): { room: string | null, eventId: string } | null {
  const v = input.trim()
  if (/^\$[^\s/?#]+$/.test(v)) return { room: null, eventId: v }
  const hash = v.indexOf('#/')
  if (!/^https:\/\//i.test(v) || hash < 0) return null
  let parts: string[]
  try {
    parts = v.slice(hash + 2).split('?')[0]!.split('/').map(decodeURIComponent)
  }
  catch { return null }
  if (parts[0] === 'room') parts.shift()
  const [room, eventId] = parts
  if (!room || !eventId || !/^[!#][^:\s]+:\S+$/.test(room) || !/^\$\S+$/.test(eventId)) return null
  return { room, eventId }
}

/** Room id for an id or alias. */
export async function resolveRoom(c: MatrixClient, room: string): Promise<string> {
  if (!room.startsWith('#')) return room
  return (await matrixRequest<{ room_id: string }>(c, 'GET', `/directory/room/${encodeURIComponent(room)}`)).room_id
}

interface MatrixEvent {
  event_id: string
  type: string
  sender: string
  origin_server_ts: number
  content: Record<string, unknown>
  unsigned?: Record<string, unknown>
}

/** One event of a room. */
export function getEvent(c: MatrixClient, roomId: string, eventId: string): Promise<MatrixEvent> {
  return matrixRequest<MatrixEvent>(c, 'GET', `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`)
}

/** The thread root for an event: itself, or the root of the thread it replies in. */
export async function threadRootOf(c: MatrixClient, roomId: string, eventId: string): Promise<string> {
  const e = await getEvent(c, roomId, eventId)
  if (e.type !== 'm.room.message') throw new MatrixError('That event is not a message', null, 'KANSO_NOT_MESSAGE')
  const rel = e.content['m.relates_to'] as { rel_type?: unknown, event_id?: unknown } | undefined
  return rel?.rel_type === 'm.thread' && typeof rel.event_id === 'string' ? rel.event_id : e.event_id
}

/** Sends an m.room.message; `txnId` makes a retry with the same id a no-op. Returns the event id. */
export async function sendMessage(c: MatrixClient, roomId: string, content: Record<string, unknown>, txnId: string): Promise<string> {
  const res = await matrixRequest<{ event_id: string }>(c, 'PUT',
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`, content)
  return res.event_id
}

const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Root message for a card's new thread: "<title> · <board>", the title linking to the card when the site URL is known. */
export function cardThreadRoot(card: { id: string, title: string }, board: { id: string, name: string }, siteUrl: string | null) {
  const url = siteUrl ? `${siteUrl}/boards/${board.id}?card=${card.id}` : null
  return {
    msgtype: 'm.text',
    body: `${card.title} · ${board.name}${url ? `\n${url}` : ''}`,
    format: 'org.matrix.custom.html',
    formatted_body: `${url ? `<a href="${htmlEscape(url)}"><strong>${htmlEscape(card.title)}</strong></a>` : `<strong>${htmlEscape(card.title)}</strong>`} · ${htmlEscape(board.name)}`,
  }
}

/** The board's Matrix bot for anyone on the board (app.matrix_room_bot), or a 400 when none is connected. */
export async function boardMatrixBot(tx: Tx, boardId: string): Promise<MatrixClient & { roomId: string }> {
  const [row] = await tx.execute<{ homeserver_url: string, room_id: string, access_token: string }>(
    sql`select * from app.matrix_room_bot(${boardId})`)
  if (!row) throw createError({ statusCode: 400, statusMessage: 'This board has no Matrix room' })
  const accessToken = openMatrixToken(row.access_token)
  if (!accessToken) throw createError({ statusCode: 400, statusMessage: 'Matrix: the stored token cannot be read any more. A board owner has to enter it again.' })
  return { homeserverUrl: row.homeserver_url, accessToken, roomId: row.room_id }
}
