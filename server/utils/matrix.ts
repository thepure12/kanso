import { createHmac, timingSafeEqual } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { Marked } from 'marked'
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

/** Calls `/_matrix/client/<version><path>` as the bot. */
export function matrixRequest<T>(c: MatrixClient, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, version: 'v1' | 'v3' = 'v3'): Promise<T> {
  return call<T>(method, `${baseUrl(c.homeserverUrl)}/_matrix/client/${version}${path}`, c.accessToken, body)
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

/** What checkMatrixRoom finds out about a connection. */
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

export interface MatrixEvent {
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

/** Most thread messages loaded (newest kept). */
const THREAD_LIMIT = 200

/**
 * A thread's root and its replies, oldest first (at most THREAD_LIMIT
 * replies, the newest), through the relations API. `more` is true when older
 * replies were left out.
 */
export async function loadThreadEvents(c: MatrixClient, roomId: string, rootId: string): Promise<{ root: MatrixEvent, replies: MatrixEvent[], more: boolean }> {
  const root = await getEvent(c, roomId, rootId)
  const replies: MatrixEvent[] = []
  let from: string | undefined
  do {
    const page = await matrixRequest<{ chunk: MatrixEvent[], next_batch?: string }>(c, 'GET',
      `/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(rootId)}/m.thread?dir=b&limit=100${from ? `&from=${encodeURIComponent(from)}` : ''}`,
      undefined, 'v1')
    replies.push(...page.chunk)
    from = page.next_batch
  } while (from && replies.length < THREAD_LIMIT)
  return { root, replies: replies.slice(0, THREAD_LIMIT).reverse(), more: !!from || replies.length > THREAD_LIMIT }
}

/** Display names of room members (falls back to the user id), one request per person. */
export async function memberNames(c: MatrixClient, roomId: string, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await Promise.all([...new Set(userIds)].slice(0, 50).map(async (u) => {
    try {
      const m = await matrixRequest<{ displayname?: unknown }>(c, 'GET', `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(u)}`)
      if (typeof m.displayname === 'string' && m.displayname.trim()) names.set(u, m.displayname.trim())
    }
    catch { /* left the room or unknown: the id is shown */ }
  }))
  return names
}

/** Strips a reply fallback ("> <@user> quoted" lines, `<mx-reply>`) from a message that replies to another. */
function stripReplyFallback(content: Record<string, unknown>, body: string, html: string | null) {
  const rel = content['m.relates_to'] as { 'm.in_reply_to'?: unknown, 'is_falling_back'?: unknown } | undefined
  if (!rel?.['m.in_reply_to'] || rel.is_falling_back) return { body, html }
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && lines[i]!.startsWith('> ')) i++
  if (i && lines[i] === '') i++
  return { body: i ? lines.slice(i).join('\n') : body, html: html?.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/, '') ?? null }
}

/** An image in a thread message (m.image or m.sticker), still as its mxc:// URI. */
export interface ThreadImage {
  mxc: string
  name: string
  width: number | null
  height: number | null
}

export interface ThreadMessageContent {
  body: string
  html: string | null
  edited: boolean
  image?: ThreadImage
}

/** `mxc://<server>/<media id>` split into its parts; null when it is not one. */
export function parseMxc(uri: string): { server: string, mediaId: string } | null {
  const m = /^mxc:\/\/([A-Za-z0-9.\-:[\]]+)\/([A-Za-z0-9_-]+)$/.exec(uri)
  return m ? { server: m[1]!, mediaId: m[2]! } : null
}

const dimension = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null

/** The image of an m.image / m.sticker content; null without a plain mxc URL (encrypted media has `file` instead). */
function imageOf(content: Record<string, unknown>): ThreadImage | null {
  if (typeof content.url !== 'string' || !parseMxc(content.url)) return null
  const info = (content.info ?? {}) as { w?: unknown, h?: unknown }
  return { mxc: content.url, name: typeof content.body === 'string' ? content.body : '', width: dimension(info.w), height: dimension(info.h) }
}

/**
 * What to show for a message event: the latest edit's text when the server
 * bundled one, without reply fallback; null for redacted, non-message or
 * encrypted events. Non-text messages show their body (file name) in brackets;
 * images (and stickers) also carry `image`.
 */
export function messageContent(e: MatrixEvent): ThreadMessageContent | null {
  if (e.unsigned?.redacted_because) return null
  if (e.type === 'm.sticker') {
    const image = imageOf(e.content)
    return image ? { body: `[${image.name}]`, html: null, edited: false, image } : null
  }
  if (e.type !== 'm.room.message') return null
  const replace = (e.unsigned?.['m.relations'] as { 'm.replace'?: { content?: { 'm.new_content'?: Record<string, unknown> } } } | undefined)?.['m.replace']
  const edit = replace?.content?.['m.new_content']
  const content = edit && typeof edit.body === 'string' ? edit : e.content
  if (typeof content.body !== 'string') return null
  const msgtype = content.msgtype
  if (msgtype === 'm.image' || msgtype === 'm.file' || msgtype === 'm.video' || msgtype === 'm.audio') {
    const image = msgtype === 'm.image' ? imageOf(content) : null
    return { body: `[${content.body}]`, html: null, edited: !!edit, ...(image && { image }) }
  }
  const html = content.format === 'org.matrix.custom.html' && typeof content.formatted_body === 'string' ? content.formatted_body : null
  const stripped = stripReplyFallback(e.content, content.body, html)
  return { body: msgtype === 'm.emote' ? `* ${stripped.body}` : stripped.body, html: msgtype === 'm.emote' ? null : stripped.html, edited: !!edit }
}

/** Event content key carrying the Kanso person a bot message was written by (trusted only on the bot's own messages). */
export const KANSO_AUTHOR_KEY = 'app.kanso.author'

const markdown = new Marked({ gfm: true, breaks: true, async: false })
// Raw HTML in the text is shown as typed, not passed on as markup.
markdown.use({ renderer: { html: ({ text }) => htmlEscape(text) } })

/** The person a Kanso reply was written by; `mxid` when they linked their Matrix account on the board. */
export interface KansoAuthor {
  id: string
  name: string
  mxid?: string
  /** The reply follows one of theirs, so it was sent without the author line. */
  continued?: true
}

/** matrix.to link of a Matrix user, which clients show as a pill. */
const userPermalink = (mxid: string) => `https://matrix.to/#/${mxid}`

/** The author's name in a Kanso reply's HTML: a pill of their Matrix account when linked, else their name in bold. */
function authorHtml(author: KansoAuthor) {
  return author.mxid
    ? `<a href="${htmlEscape(userPermalink(author.mxid))}">${htmlEscape(author.name)}</a>`
    : `<strong>${htmlEscape(author.name)}</strong>`
}

/**
 * A reply written in Kanso, sent by the bot into the thread: the author's name
 * on its own line above the text, a pill of their Matrix account when linked
 * (left out when `continued`: the thread's latest message is already theirs);
 * Markdown rendered for formatted_body; the author in KANSO_AUTHOR_KEY so the
 * card's Matrix tab can show their name. Empty `m.mentions`: a pill or name
 * in the text notifies nobody.
 */
export function threadReplyContent(rootId: string, author: KansoAuthor, text: string, continued = false) {
  const html = (markdown.parse(text) as string).trim()
  const head = authorHtml(author)
  const { continued: _, ...who } = author
  return {
    'msgtype': 'm.text',
    'body': continued ? text : `${author.name}\n${text}`,
    'format': 'org.matrix.custom.html',
    'formatted_body': continued ? html : html.startsWith('<p>') ? `<p>${head}<br>${html.slice(3)}` : `${head}<br>${html}`,
    'm.relates_to': { 'rel_type': 'm.thread', 'event_id': rootId, 'is_falling_back': true, 'm.in_reply_to': { event_id: rootId } },
    'm.mentions': {},
    [KANSO_AUTHOR_KEY]: continued ? { ...who, continued: true } : who,
  }
}

/** The Kanso author recorded on one of the bot's messages, if any. */
export function kansoAuthor(e: MatrixEvent): KansoAuthor | null {
  const a = e.content[KANSO_AUTHOR_KEY] as { id?: unknown, name?: unknown, mxid?: unknown, continued?: unknown } | undefined
  if (typeof a?.id !== 'string' || typeof a.name !== 'string') return null
  return {
    id: a.id,
    name: a.name,
    ...(typeof a.mxid === 'string' && { mxid: a.mxid }),
    ...(a.continued === true && { continued: true as const }),
  }
}

/**
 * Whether the thread's latest reply is the bot's, written in Kanso by `userId`;
 * then a new reply of theirs needs no author line. False when it cannot tell.
 */
export async function threadEndsWithAuthor(c: MatrixClient, roomId: string, rootId: string, botUserId: string, userId: string): Promise<boolean> {
  try {
    const page = await matrixRequest<{ chunk: MatrixEvent[] }>(c, 'GET',
      `/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(rootId)}/m.thread?dir=b&limit=1`, undefined, 'v1')
    const last = page.chunk[0]
    return !!last && last.sender === botUserId && !last.unsigned?.redacted_because && kansoAuthor(last)?.id === userId
  }
  catch {
    return false
  }
}

/**
 * Drops the author line that threadReplyContent puts in front (or the
 * "<name>:" of older replies), since the tab shows the name already.
 */
export function withoutAuthorPrefix(c: ThreadMessageContent, author: KansoAuthor): ThreadMessageContent {
  const name = authorHtml(author)
  let { body, html } = c
  const firstLine = body.indexOf('\n')
  if (body.startsWith(`${author.name}: `)) body = body.slice(author.name.length + 2)
  else if (firstLine >= 0 && body.slice(0, firstLine).includes(author.name)) body = body.slice(firstLine + 1)
  // Older replies: "<strong>Name:</strong> text" with the colon inside the bold.
  const old = `<strong>${htmlEscape(author.name)}:</strong>`
  if (html?.startsWith(`<p>${old} `)) html = `<p>${html.slice(old.length + 4)}`
  else if (html?.startsWith(`${old}<br>`)) html = html.slice(old.length + 4)
  else if (html) {
    const p = html.startsWith('<p>') ? 3 : 0
    const br = html.indexOf('<br>', p)
    if (br >= 0 && html.slice(p, br).includes(name)) html = `${p ? '<p>' : ''}${html.slice(br + 4)}`
  }
  return { ...c, body, html }
}

/** How a link code is sent in the room. */
export const matrixLinkMessage = (code: string) => `kanso-link ${code}`

/**
 * The newest message in the room from `mxid` (sent since `since`) that
 * carries `code`, among their last 50 messages; null when there is none.
 */
export async function findLinkCode(c: MatrixClient, roomId: string, mxid: string, code: string, since: Date): Promise<MatrixEvent | null> {
  const filter = JSON.stringify({ types: ['m.room.message'], senders: [mxid] })
  const page = await matrixRequest<{ chunk: MatrixEvent[] }>(c, 'GET',
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50&filter=${encodeURIComponent(filter)}`)
  // A minute of slack for clocks that differ between Kanso and the homeserver.
  const after = since.getTime() - 60_000
  return page.chunk.find(e => e.sender === mxid && e.type === 'm.room.message' && e.origin_server_ts >= after
    && typeof e.content.body === 'string' && e.content.body.toUpperCase().includes(code)) ?? null
}

/** Redacts an event as the bot; false when that fails (e.g. the bot may not redact others' messages). */
export async function redactEvent(c: MatrixClient, roomId: string, eventId: string, reason: string): Promise<boolean> {
  try {
    await matrixRequest(c, 'PUT', `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(`kanso-redact-${eventId}`)}`, { reason })
    return true
  }
  catch { return false }
}

/**
 * Signature of a card's media URL, so the media route only fetches mxc URIs
 * that the thread GET handed out for that card (not any media the bot can
 * reach). Keyed by the session password.
 */
export function matrixMediaSig(cardId: string, mxc: string): string {
  return createHmac('sha256', useRuntimeConfig().session.password).update(`matrix-media:${cardId}:${mxc}`).digest('base64url').slice(0, 32)
}

export function checkMatrixMediaSig(cardId: string, mxc: string, sig: string): boolean {
  const expected = Buffer.from(matrixMediaSig(cardId, mxc))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** Largest media file passed through (full size; thumbnails are much smaller). */
const MEDIA_MAX_BYTES = 10 * 1024 * 1024

/**
 * Downloads a media file (or a thumbnail of at most 800×600) as the bot:
 * authenticated media (`/_matrix/client/v1/media`, Matrix 1.11), falling back
 * to the older unauthenticated `/_matrix/media/v3` on servers without it.
 */
export async function downloadMatrixMedia(c: MatrixClient, mxc: string, thumbnail: boolean): Promise<{ data: Buffer, contentType: string | null }> {
  const parsed = parseMxc(mxc)
  if (!parsed) throw new MatrixError('Not a Matrix media URI', null, null)
  const path = `${thumbnail ? 'thumbnail' : 'download'}/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.mediaId)}`
    + (thumbnail ? '?width=800&height=600&method=scale&animated=true' : '')
  const get = (url: string, token: string | null) => httpRequest({
    method: 'GET',
    url,
    headers: { 'user-agent': 'Kanso', ...(token && { authorization: `Bearer ${token}` }) },
    allowPrivate: webhookAllowPrivate(),
    timeoutMs: 15_000,
    maxBytes: MEDIA_MAX_BYTES,
  })
  const errcode = (body?: string) => {
    try {
      const j = body ? JSON.parse(body) : null
      return { errcode: typeof j?.errcode === 'string' ? j.errcode as string : null, error: typeof j?.error === 'string' ? j.error as string : null }
    }
    catch { return { errcode: null, error: null } }
  }
  let res = await get(`${baseUrl(c.homeserverUrl)}/_matrix/client/v1/media/${path}`, c.accessToken)
  if (!res.ok && (res.status === 404 || res.status === 405) && errcode(res.body).errcode === 'M_UNRECOGNIZED') {
    res = await get(`${baseUrl(c.homeserverUrl)}/_matrix/media/v3/${path}`, null)
  }
  if (!res.ok || !res.bytes) {
    const e = errcode(res.body)
    const msg = e.error ?? res.error ?? 'Request failed'
    throw new MatrixError(e.errcode ? `${e.errcode}: ${msg}` : msg, res.status, e.errcode)
  }
  return { data: res.bytes, contentType: res.contentType?.split(';')[0]!.trim().toLowerCase() ?? null }
}
