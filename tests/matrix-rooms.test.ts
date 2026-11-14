// RLS for board Matrix rooms: members read the connection, effective owners
// manage it, the sealed token is never readable by kanban_app, and
// app.matrix_room_credentials hands it to owners only. Card threads: members
// read them, editors link and unlink (not while archived). Matrix accounts:
// people link their own, verified only by app.confirm_matrix_user.
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const app = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
const auth = postgres(process.env.NUXT_AUTH_DATABASE_URL!, { onnotice: () => {} })

function as<T>(userId: string, fn: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${userId}, true)`
    return fn(sql)
  }) as Promise<T>
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

type User = { id: string, email: string }
let owner: User, editor: User, viewer: User, outsider: User
let boardId: string, cardId: string

const connect = (by: User, board = boardId) => as(by.id, sql => sql`
  insert into board_matrix_rooms (board_id, homeserver_url, room_id, bot_user_id, access_token, created_by)
  values (${board}, 'https://matrix.example', '!room:example', '@bot:example', 'sealed', ${by.id})`)

const rooms = (by: User) => as(by.id, sql => sql`select room_id, bot_user_id from board_matrix_rooms where board_id = ${boardId}`)

beforeAll(async () => {
  ;[owner, editor, viewer, outsider] = await Promise.all(['owner', 'editor', 'viewer', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Matrix board')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${viewer.email}, 'viewer')`
    const [{ id: col }] = await sql`insert into columns (board_id, title, position) values (${boardId}, 'Todo', 1) returning id`
    ;[{ id: cardId }] = await sql`insert into cards (board_id, column_id, title, position, created_by) values (${boardId}, ${col}, 'Card', 1, ${owner.id}) returning id` as any
  })
})

afterAll(async () => {
  await as(owner.id, sql => sql`delete from boards where id = ${boardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('board_matrix_rooms', () => {
  it('only owners connect a room, as themselves', async () => {
    await expect(connect(editor)).rejects.toMatchObject({ code: '42501' })
    await expect(connect(outsider)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`
      insert into board_matrix_rooms (board_id, homeserver_url, room_id, bot_user_id, access_token, created_by)
      values (${boardId}, 'https://matrix.example', '!room:example', '@bot:example', 'sealed', ${editor.id})`)).rejects.toMatchObject({ code: '42501' })
    await connect(owner)
  })

  it('members read the connection but never the token; outsiders see nothing', async () => {
    expect(await rooms(editor)).toEqual([{ room_id: '!room:example', bot_user_id: '@bot:example' }])
    expect(await rooms(outsider)).toEqual([])
    await expect(as(owner.id, sql => sql`select access_token from board_matrix_rooms`)).rejects.toMatchObject({ code: '42501' })
  })

  it('app.matrix_room_credentials returns the token to owners only', async () => {
    expect(await as(owner.id, sql => sql`select * from app.matrix_room_credentials(${boardId})`))
      .toEqual([{ homeserver_url: 'https://matrix.example', room_id: '!room:example', access_token: 'sealed' }])
    expect(await as(editor.id, sql => sql`select * from app.matrix_room_credentials(${boardId})`)).toEqual([])
    expect(await as(outsider.id, sql => sql`select * from app.matrix_room_credentials(${boardId})`)).toEqual([])
  })

  it('only owners change or disconnect it; the creator stays fixed', async () => {
    const update = (by: User) => as(by.id, sql => sql`update board_matrix_rooms set room_id = '!other:example' where board_id = ${boardId} returning room_id`)
    expect(await update(editor)).toEqual([])
    expect(await update(owner)).toEqual([{ room_id: '!other:example' }])
    await expect(as(owner.id, sql => sql`update board_matrix_rooms set created_by = ${editor.id} where board_id = ${boardId}`)).rejects.toMatchObject({ code: '42501' })
    await expect(as(owner.id, sql => sql`update board_matrix_rooms set homeserver_url = 'ftp://x' where board_id = ${boardId}`)).rejects.toMatchObject({ code: '23514' })
    expect(await as(editor.id, sql => sql`delete from board_matrix_rooms where board_id = ${boardId} returning board_id`)).toEqual([])
    expect(await as(owner.id, sql => sql`delete from board_matrix_rooms where board_id = ${boardId} returning board_id`)).toHaveLength(1)
  })
})

describe('card_matrix_threads', () => {
  const link = (by: User, createdBy = by.id) => as(by.id, sql => sql`
    insert into card_matrix_threads (card_id, board_id, room_id, event_id, created_by)
    values (${cardId}, ${boardId}, '!room:example', '$root', ${createdBy})`)
  const threads = (by: User) => as(by.id, sql => sql`select event_id from card_matrix_threads where card_id = ${cardId}`)

  it('editors link a card as themselves; viewers and outsiders cannot', async () => {
    await expect(link(viewer)).rejects.toMatchObject({ code: '42501' })
    await expect(link(outsider)).rejects.toMatchObject({ code: '42501' })
    await expect(link(editor, owner.id)).rejects.toMatchObject({ code: '42501' })
    await link(editor)
    await expect(link(owner)).rejects.toMatchObject({ code: '23505' })
  })

  it('members read the link, outsiders do not', async () => {
    expect(await threads(viewer)).toEqual([{ event_id: '$root' }])
    expect(await threads(outsider)).toEqual([])
  })

  it('app.matrix_room_bot returns the room and token to anyone on the board', async () => {
    await connect(owner)
    const bot = { homeserver_url: 'https://matrix.example', room_id: '!room:example', access_token: 'sealed' }
    expect(await as(viewer.id, sql => sql`select * from app.matrix_room_bot(${boardId})`)).toEqual([bot])
    expect(await as(outsider.id, sql => sql`select * from app.matrix_room_bot(${boardId})`)).toEqual([])
  })

  it('nothing changes while the board is archived; viewers never unlink', async () => {
    expect(await as(viewer.id, sql => sql`delete from card_matrix_threads where card_id = ${cardId} returning card_id`)).toEqual([])
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    expect(await as(owner.id, sql => sql`delete from card_matrix_threads where card_id = ${cardId} returning card_id`)).toEqual([])
    await as(owner.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    expect(await as(editor.id, sql => sql`delete from card_matrix_threads where card_id = ${cardId} returning card_id`)).toHaveLength(1)
  })
})

describe('board_matrix_users', () => {
  const start = (by: User, mxid = '@viewer:example', userId = by.id) => as(by.id, sql => sql`
    insert into board_matrix_users (board_id, user_id, mxid) values (${boardId}, ${userId}, ${mxid}) returning code`)
  const confirm = (by: User, code: string) => as(by.id, async sql => (await sql`select app.confirm_matrix_user(${boardId}, ${code}) as ok`)[0]!.ok)
  const links = (by: User) => as(by.id, sql => sql`select user_id, mxid, code, verified_at is not null as verified from board_matrix_users where board_id = ${boardId} order by mxid, user_id`)

  it('anyone on the board starts a link for themselves; the database picks the code', async () => {
    await expect(start(outsider)).rejects.toMatchObject({ code: '42501' })
    await expect(start(viewer, '@viewer:example', editor.id)).rejects.toMatchObject({ code: '42501' })
    await expect(as(viewer.id, sql => sql`
      insert into board_matrix_users (board_id, user_id, mxid, code) values (${boardId}, ${viewer.id}, '@viewer:example', 'MINE')`)).rejects.toMatchObject({ code: '42501' })
    await expect(as(viewer.id, sql => sql`
      insert into board_matrix_users (board_id, user_id, mxid, verified_at) values (${boardId}, ${viewer.id}, '@viewer:example', now())`)).rejects.toMatchObject({ code: '42501' })
    await expect(start(viewer, 'not an id')).rejects.toMatchObject({ code: '23514' })
    const [{ code }] = await start(viewer) as any
    expect(code).toMatch(/^[0-9A-F]{10}$/)
  })

  it('pending links are private; app.confirm_matrix_user verifies the caller\'s own with the right code', async () => {
    expect(await links(editor)).toEqual([])
    const [{ code }] = await links(viewer) as any
    expect(await confirm(viewer, 'WRONG')).toBe(false)
    expect(await confirm(editor, code)).toBe(false)
    expect(await confirm(viewer, code)).toBe(true)
    expect(await links(editor)).toEqual([{ user_id: viewer.id, mxid: '@viewer:example', code: null, verified: true }])
    expect(await links(outsider)).toEqual([])
  })

  it('a newer proof for the same Matrix ID replaces the other person\'s link', async () => {
    const [{ code }] = await start(editor) as any
    expect(await confirm(editor, code)).toBe(true)
    expect(await links(owner)).toEqual([{ user_id: editor.id, mxid: '@viewer:example', code: null, verified: true }])
  })

  it('people unlink only themselves; disconnecting the room drops the links', async () => {
    expect(await as(owner.id, sql => sql`delete from board_matrix_users where board_id = ${boardId} returning user_id`)).toEqual([])
    await start(owner, '@owner:example')
    await as(owner.id, sql => sql`delete from board_matrix_rooms where board_id = ${boardId}`)
    expect(await as(owner.id, sql => sql`select 1 from board_matrix_users where board_id = ${boardId}`)).toEqual([])
    await connect(owner)
  })
})
