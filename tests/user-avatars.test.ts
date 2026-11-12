// Profile pictures (user_avatars) under RLS.
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

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

type User = { id: string, email: string }
let alice: User, bob: User, eve: User
let boardId: string

const upload = (userId: string, owner: string) =>
  as(userId, sql => sql`
    insert into user_avatars (user_id, content_type, size, data) values (${owner}, 'image/png', ${png.length}, ${png})
    on conflict (user_id) do update set data = excluded.data, size = excluded.size`)
const read = (userId: string, owner: string) =>
  as(userId, sql => sql`select content_type from user_avatars where user_id = ${owner}`)

beforeAll(async () => {
  ;[alice, bob, eve] = await Promise.all([createUser('alice'), createUser('bob'), createUser('eve')])
  await as(alice.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Avatar board')` as any
    await sql`select app.add_board_member(${boardId}, ${bob.email}, 'viewer')`
  })
})

afterAll(async () => {
  await as(alice.id, sql => sql`delete from boards where id = ${boardId}`)
  await Promise.all([app.end(), auth.end()])
})

describe('user avatars', () => {
  it('only the user uploads, replaces and removes their picture', async () => {
    await upload(alice.id, alice.id)
    await upload(alice.id, alice.id)
    await expect(upload(bob.id, alice.id)).rejects.toMatchObject({ code: '42501' })
    expect(await as(bob.id, sql => sql`update user_avatars set size = size where user_id = ${alice.id} returning user_id`)).toHaveLength(0)
    expect(await as(bob.id, sql => sql`delete from user_avatars where user_id = ${alice.id} returning user_id`)).toHaveLength(0)
    expect(await read(alice.id, alice.id)).toHaveLength(1)
  })

  it('people who share a board see it, others do not', async () => {
    expect(await read(bob.id, alice.id)).toEqual([{ content_type: 'image/png' }])
    expect(await read(eve.id, alice.id)).toHaveLength(0)
  })

  it('rejects other types', async () => {
    await expect(as(eve.id, sql => sql`
      insert into user_avatars (user_id, content_type, size, data) values (${eve.id}, 'image/svg+xml', ${png.length}, ${png})`))
      .rejects.toMatchObject({ code: '23514' })
  })

  it('lets the user remove the row', async () => {
    expect(await as(alice.id, sql => sql`delete from user_avatars where user_id = ${alice.id} returning user_id`)).toHaveLength(1)
  })
})
