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
