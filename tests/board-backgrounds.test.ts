// Board backgrounds (boards.background, board_backgrounds) under RLS.
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

async function rejectsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

async function createUser(name: string) {
  const [u] = await auth`insert into users (email, name) values (${`${name}-${randomUUID()}@test.local`}, ${name}) returning id, email`
  return u as { id: string, email: string }
}

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

type User = { id: string, email: string }
let alice: User, bob: User, carol: User, dave: User
let boardId: string

beforeAll(async () => {
  ;[alice, bob, carol, dave] = await Promise.all([createUser('alice'), createUser('bob'), createUser('carol'), createUser('dave')])
  await as(alice.id, async (sql) => {
    ;[{ id: boardId }] = await sql`select id from app.create_board('Background board')` as any
    await sql`select app.add_board_member(${boardId}, ${bob.email}, 'editor')`
    await sql`select app.add_board_member(${boardId}, ${carol.email}, 'viewer')`
  })
})

afterAll(async () => {
  await as(alice.id, sql => sql`delete from boards where id = ${boardId}`)
  await Promise.all([app.end(), auth.end()])
})

const setBackground = (userId: string, bg: unknown) =>
  as(userId, sql => sql`update boards set background = ${sql.json(bg as any)} where id = ${boardId} returning background`)
const uploadImage = (userId: string) =>
  as(userId, sql => sql`
    insert into board_backgrounds (board_id, content_type, size, data) values (${boardId}, 'image/png', ${png.length}, ${png})
    on conflict (board_id) do update set data = excluded.data, size = excluded.size`)

describe('board background', () => {
  it('only owners change it, everyone with access sees it', async () => {
    expect(await setBackground(alice.id, { kind: 'gradient', value: 'ocean' })).toHaveLength(1)
    expect(await setBackground(bob.id, { kind: 'color', value: '#000000' })).toHaveLength(0)
    expect(await setBackground(carol.id, { kind: 'color', value: '#000000' })).toHaveLength(0)
    expect(await as(carol.id, sql => sql`select background from boards where id = ${boardId}`))
      .toEqual([{ background: { kind: 'gradient', value: 'ocean' } }])
    expect(await as(dave.id, sql => sql`select background from boards where id = ${boardId}`)).toHaveLength(0)
  })

  it('rejects malformed values', async () => {
    await rejectsWith(setBackground(alice.id, { kind: 'color', value: 'red' }), '23514')
    await rejectsWith(setBackground(alice.id, { kind: 'video', value: 'x' }), '23514')
    await rejectsWith(setBackground(alice.id, { kind: 'photo', value: '../../etc' }), '23514')
  })

  it('an upload background needs its image, which only owners store', async () => {
    await rejectsWith(setBackground(alice.id, { kind: 'upload', value: 'abc123' }), 'KB009')
    await rejectsWith(uploadImage(bob.id), '42501')
    await rejectsWith(uploadImage(carol.id), '42501')
    await uploadImage(alice.id)
    expect(await setBackground(alice.id, { kind: 'upload', value: 'abc123' })).toHaveLength(1)
    // Viewers read the image; outsiders do not.
    expect(await as(carol.id, sql => sql`select size from board_backgrounds where board_id = ${boardId}`)).toEqual([{ size: png.length }])
    expect(await as(dave.id, sql => sql`select 1 from board_backgrounds where board_id = ${boardId}`)).toHaveLength(0)
    expect((await as(bob.id, sql => sql`delete from board_backgrounds where board_id = ${boardId}`)).count).toBe(0)
  })

  it('drops the uploaded image once another background is chosen', async () => {
    expect(await setBackground(alice.id, { kind: 'photo', value: 'alps' })).toHaveLength(1)
    expect(await as(alice.id, sql => sql`select 1 from board_backgrounds where board_id = ${boardId}`)).toHaveLength(0)
    expect(await as(alice.id, sql => sql`update boards set background = null where id = ${boardId} returning id`)).toHaveLength(1)
  })

  it('cannot be changed while the board is archived', async () => {
    await as(alice.id, sql => sql`select app.set_board_archived(${boardId}, true)`)
    try {
      expect(await setBackground(alice.id, { kind: 'gradient', value: 'ocean' })).toHaveLength(0)
      await rejectsWith(uploadImage(alice.id), '42501')
    }
    finally {
      await as(alice.id, sql => sql`select app.set_board_archived(${boardId}, false)`)
    }
  })
})

describe('board accent', () => {
  const setAccent = (userId: string, accent: string | null) =>
    as(userId, sql => sql`update boards set accent = ${accent} where id = ${boardId} returning accent`)

  it('only owners change it, viewers see it, unknown names are refused', async () => {
    expect(await setAccent(alice.id, 'emerald')).toEqual([{ accent: 'emerald' }])
    expect(await setAccent(bob.id, 'rose')).toHaveLength(0)
    expect(await setAccent(carol.id, 'rose')).toHaveLength(0)
    expect(await as(carol.id, sql => sql`select accent from boards where id = ${boardId}`)).toEqual([{ accent: 'emerald' }])
    await rejectsWith(setAccent(alice.id, '#ff0000'), '23514')
    expect(await setAccent(alice.id, null)).toEqual([{ accent: null }])
  })
})
