// RLS for board Matrix rooms: members read the connection, effective owners
// manage it, the sealed token is never readable by kanban_app, and
// app.matrix_room_credentials hands it to owners only.
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
let owner: User, editor: User, outsider: User
let boardId: string

const connect = (by: User, board = boardId) => as(by.id, sql => sql`
  insert into board_matrix_rooms (board_id, homeserver_url, room_id, bot_user_id, access_token, created_by)
  values (${board}, 'https://matrix.example', '!room:example', '@bot:example', 'sealed', ${by.id})`)

const rooms = (by: User) => as(by.id, sql => sql`select room_id, bot_user_id from board_matrix_rooms where board_id = ${boardId}`)

beforeAll(async () => {
  ;[owner, editor, outsider] = await Promise.all(['owner', 'editor', 'outsider'].map(createUser)) as User[]
  await as(owner.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Matrix board')` as any
    await sql`select app.add_board_member(${boardId}, ${editor.email}, 'editor')`
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
